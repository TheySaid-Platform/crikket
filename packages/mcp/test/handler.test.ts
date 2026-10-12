import { describe, expect, it } from "bun:test"

import type { McpAuthResult } from "../src/auth"
import { MAX_TOOL_RESULT_CHARS } from "../src/format"
import {
  createMcpRequestHandler,
  MAX_MCP_REQUEST_BODY_BYTES,
  type McpRequestHandlerDependencies,
} from "../src/handler"
import { MediaBusyError } from "../src/media/gate"
import type { VideoFrameService } from "../src/media/video-frames"
import type { CrikketReader } from "../src/reader"
import { BUG_CONTEXT_BUDGET_CHARS } from "../src/tools/get-bug-context"
import type { SessionContext } from "../src/types"
import {
  APP_ORIGIN,
  makeEvents,
  makeReader,
  makeReport,
  makeRequests,
  makeUser,
} from "./fixtures"

const allowed: McpAuthResult = {
  ok: true,
  principal: {
    keyId: "key_1",
    keyExpiresAt: null,
    organizationId: "org_a",
    user: makeUser(),
  },
}

function setup(input: {
  reader?: CrikketReader
  auth?: McpAuthResult
  limitUser?: McpRequestHandlerDependencies["limitUser"]
  frames?: VideoFrameService
}) {
  const sessions: SessionContext[] = []
  const handler = createMcpRequestHandler({
    appOrigin: APP_ORIGIN,
    authenticate: async () => input.auth ?? allowed,
    createReader: (session) => {
      sessions.push(session)
      return input.reader ?? makeReader({})
    },
    limitUser: input.limitUser,
    frames: input.frames,
  })

  return { handler, sessions }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-06-18",
      authorization: "Bearer crk_mcp_test",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

type ToolResult = {
  isError?: boolean
  content: { type: string; text: string; data?: string; mimeType?: string }[]
}

async function callTool(
  handler: (request: Request) => Promise<Response>,
  name: string,
  args: Record<string, unknown>
): Promise<{ result: ToolResult; text: string; json: () => any }> {
  const response = await handler(
    post({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    })
  )
  if (response.status !== 200) {
    throw new Error(`tools/call ${name} returned HTTP ${response.status}`)
  }
  const body = (await response.json()) as { result: ToolResult }
  const text = body.result.content[0]?.text ?? ""
  return { result: body.result, text, json: () => JSON.parse(text) }
}

describe("MCP request handler: HTTP layer", () => {
  it("only accepts POST", async () => {
    const { handler } = setup({})
    const response = await handler(
      new Request("http://localhost/api/mcp", { method: "GET" })
    )

    expect(response.status).toBe(405)
    expect(response.headers.get("allow")).toBe("POST")
  })

  it("returns 401 with a WWW-Authenticate challenge when auth fails", async () => {
    const { handler, sessions } = setup({
      auth: {
        ok: false,
        failure: {
          status: 401,
          code: "invalid_token",
          message: "The access key is invalid, expired or revoked.",
        },
      },
    })
    const response = await handler(
      post({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    )

    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toContain(
      'error="invalid_token"'
    )
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      error: { message: "The access key is invalid, expired or revoked." },
    })
    expect(sessions).toHaveLength(0)
  })

  it("returns 403 without a challenge when the user lost access", async () => {
    const { handler } = setup({
      auth: {
        ok: false,
        failure: { status: 403, code: "access_denied", message: "nope" },
      },
    })
    const response = await handler(
      post({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    )

    expect(response.status).toBe(403)
    expect(response.headers.get("www-authenticate")).toBe(null)
  })

  it("applies the per-user limit after auth", async () => {
    const limited: string[] = []
    const { handler } = setup({
      limitUser: ({ userId }) => {
        limited.push(userId)
        return Promise.resolve({ allowed: false, retryAfterSeconds: 30 })
      },
    })
    const response = await handler(
      post({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("30")
    expect(limited).toEqual(["user_1"])
  })

  it("refuses oversized bodies and invalid JSON", async () => {
    const { handler } = setup({})

    const tooBig = await handler(
      post(`"${"a".repeat(MAX_MCP_REQUEST_BODY_BYTES)}"`)
    )
    expect(tooBig.status).toBe(413)

    const invalid = await handler(post("{nope"))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ error: { code: -32_700 } })
  })

  it("answers initialize with server info and instructions", async () => {
    const { handler } = setup({})
    const response = await handler(
      post({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      result: { serverInfo: { name: string }; instructions: string }
    }
    expect(body.result.serverInfo.name).toBe("crikket")
    expect(body.result.instructions).toContain("get_bug_context")
  })

  it("lists eight read-only tools", async () => {
    const { handler } = setup({})
    const response = await handler(
      post({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    )
    const body = (await response.json()) as {
      result: {
        tools: { name: string; annotations?: { readOnlyHint?: boolean } }[]
      }
    }

    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual([
      "get_bug_context",
      "get_bug_report",
      "get_console_logs",
      "get_network_request_details",
      "get_network_requests",
      "get_reproduction_steps",
      "get_video_frames",
      "list_bug_reports",
    ])
    for (const tool of body.result.tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true)
    }
  })

  it("builds the procedure session from the verified key", async () => {
    const { handler, sessions } = setup({})
    await handler(
      post(
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { "user-agent": "claude-code/2" }
      )
    )

    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.session.activeOrganizationId).toBe("org_a")
    expect(sessions[0]?.user.id).toBe("user_1")
    expect(sessions[0]?.session.userAgent).toBe("claude-code/2")
  })
})

describe("MCP tools", () => {
  const report = makeReport({ id: "rpt_1" })

  it("get_bug_report accepts a share link and returns the summary", async () => {
    const reader = makeReader({ reports: { rpt_1: report } })
    const { handler } = setup({ reader })
    const { result, json } = await callTool(handler, "get_bug_report", {
      report: "https://crikket.example.com/s/rpt_1",
    })

    expect(result.isError).toBeUndefined()
    expect(json()).toMatchObject({
      id: "rpt_1",
      shareUrl: `${APP_ORIGIN}/s/rpt_1`,
      title: "Checkout button spins forever",
      pageTitle: "Checkout",
      capture: { type: "video", duration: "1:42" },
      tabs: [{ tabId: 11, title: "Checkout" }],
      organization: "Acme",
    })
  })

  it("explains a report it cannot see without leaking why", async () => {
    const { handler } = setup({ reader: makeReader({}) })
    const { result, text } = await callTool(handler, "get_bug_context", {
      report: "rpt_other_org",
    })

    expect(result.isError).toBe(true)
    expect(text).toContain("Bug report not found")
  })

  it("rejects a bad report reference before reading anything", async () => {
    const reader = makeReader({ reports: { rpt_1: report } })
    const { handler } = setup({ reader })
    const { result, text } = await callTool(handler, "get_bug_report", {
      report: "https://evil.example.com/reports/1",
    })

    expect(result.isError).toBe(true)
    expect(text).toContain("is not a bug report id")
    expect(reader.calls).toEqual([])
  })

  it("hides unexpected errors behind a generic message", async () => {
    const reader = makeReader({ failWith: new Error("db password=hunter2") })
    const { handler } = setup({ reader })
    const originalError = console.error
    console.error = () => undefined
    try {
      const { result, text } = await callTool(handler, "get_bug_report", {
        report: "rpt_1",
      })
      expect(result.isError).toBe(true)
      expect(text).not.toContain("hunter2")
    } finally {
      console.error = originalError
    }
  })

  it("get_bug_context stays within budget on a heavy report", async () => {
    const reader = makeReader({
      reports: { rpt_1: report },
      events: {
        rpt_1: makeEvents({
          actions: 300,
          errors: 200,
          warnings: 100,
          infos: 50,
          messageLength: 3000,
        }),
      },
      requests: { rpt_1: makeRequests({ total: 1200, failEvery: 3 }) },
    })
    const { handler } = setup({ reader })
    const { text, json } = await callTool(handler, "get_bug_context", {
      report: "rpt_1",
    })
    const context = json()

    expect(text.length).toBeLessThanOrEqual(BUG_CONTEXT_BUDGET_CHARS)
    expect(context.summary).toEqual({
      steps: 300,
      consoleLogs: 350,
      consoleErrors: 200,
      consoleWarnings: 100,
      networkRequests: 1200,
      failedNetworkRequests: 400,
    })
    expect(context.steps[0].step).toBe(1)
    expect(context.steps.at(-1).step).toBe(300)
    expect(context.notes.length).toBeGreaterThanOrEqual(3)
    // All 1200 requests were read across pages of 200.
    expect(
      reader.calls.filter((call) => call.startsWith("getNetworkRequestsPage"))
    ).toHaveLength(6)
  })

  it("get_bug_context warns when debugger data is still processing", async () => {
    const reader = makeReader({
      reports: { rpt_1: makeReport({ debuggerIngestionStatus: "processing" }) },
    })
    const { handler } = setup({ reader })
    const { json } = await callTool(handler, "get_bug_context", {
      report: "rpt_1",
    })

    expect(json().notes[0]).toContain("still being processed")
  })

  it("get_console_logs filters by level and text and pages", async () => {
    const reader = makeReader({
      reports: { rpt_1: report },
      events: { rpt_1: makeEvents({ errors: 5, warnings: 3, infos: 4 }) },
    })
    const { handler } = setup({ reader })
    const { json } = await callTool(handler, "get_console_logs", {
      report: "rpt_1",
      levels: ["warn"],
      offset: 1,
      limit: 1,
    })

    expect(json()).toMatchObject({
      total: 3,
      countsByLevel: { error: 5, warn: 3, info: 4 },
      offset: 1,
      hasMore: true,
      items: [{ level: "warn", message: "warn 6" }],
    })
  })

  it("get_network_requests filters failed requests and method across pages", async () => {
    const reader = makeReader({
      reports: { rpt_1: report },
      requests: { rpt_1: makeRequests({ total: 450, failEvery: 10 }) },
    })
    const { handler } = setup({ reader })
    const { json } = await callTool(handler, "get_network_requests", {
      report: "rpt_1",
      failedOnly: true,
      method: "post",
      limit: 200,
    })
    const page = json()

    expect(page.failedTotal).toBe(45)
    expect(page.total).toBe(45)
    expect(
      page.items.every(
        (item: { method: string; status: number }) =>
          item.method === "POST" && item.status === 500
      )
    ).toBe(true)
  })

  it("get_network_request_details returns headers and capped bodies", async () => {
    const reader = makeReader({
      reports: { rpt_1: report },
      requests: { rpt_1: makeRequests({ total: 3 }) },
      bodies: {
        req_2: { requestBody: '{"a":1}', responseBody: "z".repeat(50_000) },
      },
    })
    const { handler } = setup({ reader })
    const { json } = await callTool(handler, "get_network_request_details", {
      report: "rpt_1",
      requestId: "req_2",
    })
    const details = json()

    expect(details).toMatchObject({
      id: "req_2",
      requestHeaders: { "content-type": "application/json" },
      requestBody: '{"a":1}',
    })
    expect(details.responseBody.length).toBeLessThan(21_000)
    expect(details.responseBody).toContain("more characters")
    // One read for the one request, no paging through the list.
    expect(reader.calls).toEqual(["getNetworkRequestDetails:req_2"])
  })

  it("get_network_request_details reports a request outside the report", async () => {
    const reader = makeReader({
      reports: { rpt_1: report },
      requests: { rpt_1: makeRequests({ total: 3 }) },
    })
    const { handler } = setup({ reader })
    const { result, text } = await callTool(
      handler,
      "get_network_request_details",
      { report: "rpt_1", requestId: "req_other" }
    )

    expect(result.isError).toBe(true)
    expect(text).toBe("Network request not found.")
  })

  it("get_reproduction_steps keeps global step numbers when filtering by tab", async () => {
    const events = makeEvents({ actions: 4 })
    const reader = makeReader({
      reports: { rpt_1: report },
      events: {
        rpt_1: {
          ...events,
          actions: events.actions.map((action, index) => ({
            ...action,
            tabId: index % 2 === 0 ? 11 : 12,
          })),
        },
      },
    })
    const { handler } = setup({ reader })
    const { json } = await callTool(handler, "get_reproduction_steps", {
      report: "rpt_1",
      tabId: 12,
    })

    expect(json().items.map((item: { step: number }) => item.step)).toEqual([
      2, 4,
    ])
  })

  it("list_bug_reports maps filters onto the list procedure", async () => {
    const reader = makeReader({ reports: { rpt_1: report } })
    const { handler } = setup({ reader })
    const { json } = await callTool(handler, "list_bug_reports", {
      search: "checkout",
      statuses: ["open"],
      visibility: "public",
    })

    expect(json().items[0]).toMatchObject({
      id: "rpt_1",
      shareUrl: `${APP_ORIGIN}/s/rpt_1`,
    })
    expect(reader.calls[0]).toBe(
      'listReports:{"search":"checkout","statuses":["open"],"visibilities":["public"],"sort":"newest","page":1,"perPage":20}'
    )
  })
})

describe("MCP request handler: hardening", () => {
  it("turns an auth crash into a JSON-RPC 500", async () => {
    const handler = createMcpRequestHandler({
      appOrigin: APP_ORIGIN,
      authenticate: () => Promise.reject(new Error("db down")),
      createReader: () => makeReader({}),
    })
    const originalError = console.error
    console.error = () => undefined
    try {
      const response = await handler(
        post({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      )
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({
        jsonrpc: "2.0",
        error: { code: -32_603 },
      })
    } finally {
      console.error = originalError
    }
  })

  it("stops reading a chunked body once it passes the limit", async () => {
    const { handler } = setup({})
    const chunk = new Uint8Array(256 * 1024).fill(97)
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1
        if (sent > 64) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
      },
    })
    const response = await handler(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          authorization: "Bearer crk_mcp_test",
        },
        body,
      })
    )

    expect(response.status).toBe(413)
    expect(sent).toBeLessThan(10)
  })

  it("pages a huge log list into valid JSON with a next offset", async () => {
    const reader = makeReader({
      reports: { rpt_1: makeReport() },
      events: { rpt_1: makeEvents({ errors: 500, messageLength: 1900 }) },
    })
    const { handler } = setup({ reader })
    const { text, json } = await callTool(handler, "get_console_logs", {
      report: "rpt_1",
      limit: 500,
    })
    const page = json()

    expect(text.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS)
    expect(page.total).toBe(500)
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.length).toBeLessThan(500)
    expect(page.hasMore).toBe(true)
    expect(page.nextOffset).toBe(page.items.length)
    expect(page.note).toContain("nextOffset")
  })
})

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

function fakeFrames(options?: {
  frameEndsAtMs?: number
  failWith?: Error
}): VideoFrameService & { requests: number[][] } {
  const requests: number[][] = []
  return {
    requests,
    getVideoFrames: ({ targetsMs }) => {
      requests.push(targetsMs)
      if (options?.failWith) {
        return Promise.reject(options.failWith)
      }
      return Promise.resolve(
        targetsMs.map((targetMs) =>
          targetMs > (options?.frameEndsAtMs ?? Number.POSITIVE_INFINITY)
            ? { targetMs, frameMs: null, image: null }
            : { targetMs, frameMs: targetMs + 13, image: JPEG }
        )
      )
    },
    getScreenshot: () => Promise.resolve(JPEG),
  }
}

describe("get_video_frames", () => {
  const video = makeReport({ id: "rpt_1", attachmentType: "video" })
  const events = makeEvents({ actions: 5 })

  it("returns an image for each step and time, with captions", async () => {
    const frames = fakeFrames()
    const { handler } = setup({
      frames,
      reader: makeReader({
        reports: { rpt_1: video },
        events: { rpt_1: events },
      }),
    })
    const { result } = await callTool(handler, "get_video_frames", {
      report: "rpt_1",
      at: ["step:3", "0:01.5"],
    })

    expect(result.isError).toBeUndefined()
    // Step 3 is at 2000 ms; its frame is taken 700 ms later.
    expect(frames.requests).toEqual([[2700, 1500]])
    expect(result.content.map((item) => item.type)).toEqual([
      "text",
      "text",
      "image",
      "text",
      "image",
    ])
    expect(result.content[0]?.text).toContain("showing 2 of 2")
    expect(result.content[1]?.text).toBe(
      "step 3 (0:02.7, just after the step): frame at 0:02.7"
    )
    expect(result.content[2]).toMatchObject({
      type: "image",
      mimeType: "image/jpeg",
      data: Buffer.from(JPEG).toString("base64"),
    })
  })

  it("explains moments it cannot show and still returns the rest", async () => {
    const { handler } = setup({
      frames: fakeFrames({ frameEndsAtMs: 59_000 }),
      reader: makeReader({
        reports: { rpt_1: video },
        events: { rpt_1: events },
      }),
    })
    const { result } = await callTool(handler, "get_video_frames", {
      report: "rpt_1",
      at: ["step:9", "5:00", "0:10"],
    })

    expect(result.content.filter((item) => item.type === "image")).toHaveLength(
      1
    )
    const header = result.content[0]?.text ?? ""
    expect(header).toContain("showing 1 of 3")
    expect(header).toContain("There is no step 9")
    expect(header).toContain("past the end of the video (1:00.0 long)")
  })

  it("spreads four moments over the video when none are given", async () => {
    const frames = fakeFrames()
    const { handler } = setup({
      frames,
      reader: makeReader({
        reports: { rpt_1: video },
        captures: { rpt_1: { durationMs: 100_000 } },
      }),
    })
    await callTool(handler, "get_video_frames", { report: "rpt_1" })

    expect(frames.requests).toEqual([[10_000, 35_000, 60_000, 85_000]])
  })

  it("returns the screenshot for screenshot reports", async () => {
    const { handler } = setup({
      frames: fakeFrames(),
      reader: makeReader({
        reports: { rpt_1: makeReport({ attachmentType: "screenshot" }) },
      }),
    })
    const { result } = await callTool(handler, "get_video_frames", {
      report: "rpt_1",
      at: ["0:05"],
    })

    expect(result.content.map((item) => item.type)).toEqual(["text", "image"])
    expect(result.content[0]?.text).toContain("do not apply")
  })

  it("explains that instant replays have no video frames", async () => {
    const frames = fakeFrames()
    const { handler } = setup({
      frames,
      reader: makeReader({
        reports: { rpt_1: makeReport({ attachmentType: "replay" }) },
      }),
    })
    const { result, text } = await callTool(handler, "get_video_frames", {
      report: "rpt_1",
      at: ["0:05"],
    })

    expect(result.isError).toBe(true)
    expect(text).toContain("instant replay")
    expect(frames.requests).toEqual([])
  })

  it("checks access before touching the video", async () => {
    const frames = fakeFrames()
    const { handler } = setup({ frames, reader: makeReader({}) })
    const { result, text } = await callTool(handler, "get_video_frames", {
      report: "rpt_other_org",
      at: ["0:05"],
    })

    expect(result.isError).toBe(true)
    expect(text).toContain("Bug report not found")
    expect(frames.requests).toEqual([])
  })

  it("says clearly when frames cannot be cut", async () => {
    const reader = makeReader({
      reports: { rpt_1: video },
      captures: { rpt_1: { durationMs: 1000, hasCapture: false } },
    })
    const noCapture = await callTool(
      setup({ frames: fakeFrames(), reader }).handler,
      "get_video_frames",
      {
        report: "rpt_1",
        at: ["0:01"],
      }
    )
    expect(noCapture.text).toContain("no video or screenshot attached")

    const busy = await callTool(
      setup({
        frames: fakeFrames({ failWith: new MediaBusyError("busy") }),
        reader: makeReader({ reports: { rpt_1: video } }),
      }).handler,
      "get_video_frames",
      { report: "rpt_1", at: ["0:01"] }
    )
    expect(busy.result.isError).toBe(true)
    expect(busy.text).toContain("Try again in a minute")

    const unavailable = await callTool(
      setup({ reader: makeReader({ reports: { rpt_1: video } }) }).handler,
      "get_video_frames",
      { report: "rpt_1", at: ["0:01"] }
    )
    expect(unavailable.text).toContain("not available on this server")
  })

  it("get_bug_context points at the moments worth seeing", async () => {
    const { handler } = setup({
      reader: makeReader({
        reports: { rpt_1: video },
        events: { rpt_1: makeEvents({ actions: 5, errors: 1 }) },
      }),
    })
    const { json } = await callTool(handler, "get_bug_context", {
      report: "rpt_1",
    })

    expect(json().screen).toMatchObject({
      tool: "get_video_frames",
      suggestedMoments: ["step:1", "step:5"],
    })
  })
})
