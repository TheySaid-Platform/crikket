import { ORPCError } from "@orpc/server"

import type {
  BugReportDetails,
  BugReportListPage,
  CrikketReader,
  DebuggerEvents,
  NetworkRequestItem,
} from "../src/reader"
import type { SessionUser } from "../src/types"

export const APP_ORIGIN = "https://crikket.example.com"

export function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user_1",
    name: "Henry",
    email: "henry@example.com",
    emailVerified: true,
    image: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    role: null,
    banned: false,
    banReason: null,
    banExpires: null,
    ...overrides,
  }
}

export function makeReport(
  overrides: Partial<BugReportDetails> = {}
): BugReportDetails {
  return {
    id: "rpt_1",
    title: "Checkout button spins forever",
    description: "Pay never finishes.",
    status: "open",
    priority: "high",
    tags: ["checkout"],
    url: "https://app.example.com/checkout",
    attachmentUrl: "https://storage.example.com/video.webm?sig=1",
    attachmentType: "video",
    submissionStatus: "ready",
    debuggerIngestionStatus: "completed",
    debuggerIngestionError: null,
    visibility: "private",
    canEdit: true,
    deviceInfo: { browser: "Chrome 141", os: "macOS" },
    metadata: {
      duration: "1:42",
      pageTitle: "Checkout",
      tabs: [
        {
          tabId: 11,
          url: "https://app.example.com/checkout",
          title: "Checkout",
        },
      ],
    },
    createdAt: "2026-10-12T09:00:00.000Z",
    updatedAt: "2026-10-12T09:00:00.000Z",
    reporter: { name: "Henry", image: null },
    organization: { name: "Acme", logo: null },
    ...overrides,
  }
}

export function makeEvents(input: {
  actions?: number
  errors?: number
  warnings?: number
  infos?: number
  messageLength?: number
}): DebuggerEvents {
  const actions = Array.from({ length: input.actions ?? 0 }, (_, index) => ({
    id: `act_${index}`,
    type: index === 0 ? "navigation" : "click",
    target: index === 0 ? "window" : `button#step-${index}`,
    timestamp: new Date(Date.UTC(2026, 9, 12, 9, 0, index)).toISOString(),
    offset: index * 1000,
    metadata: null,
    tabId: 11,
    pageUrl: "https://app.example.com/checkout",
  }))

  const levels = [
    ...new Array<string>(input.errors ?? 0).fill("error"),
    ...new Array<string>(input.warnings ?? 0).fill("warn"),
    ...new Array<string>(input.infos ?? 0).fill("info"),
  ]
  const logs = levels.map((level, index) => ({
    id: `log_${index}`,
    level,
    message: `${level} ${index} ${"x".repeat(input.messageLength ?? 0)}`.trim(),
    timestamp: new Date(Date.UTC(2026, 9, 12, 9, 1, index)).toISOString(),
    offset: index * 500,
    metadata: { stack: `at app.js:${index}` },
    tabId: 11,
    pageUrl: "https://app.example.com/checkout",
  }))

  return { actions, logs }
}

export function makeRequests(input: {
  total: number
  failEvery?: number
}): NetworkRequestItem[] {
  return Array.from({ length: input.total }, (_, index) => {
    const failed = input.failEvery ? index % input.failEvery === 0 : false
    return {
      id: `req_${index}`,
      method: index % 2 === 0 ? "POST" : "GET",
      url: `https://api.example.com/v1/items/${index}`,
      status: failed ? 500 : 200,
      duration: 100 + index,
      requestHeaders: { "content-type": "application/json" },
      responseHeaders: { "content-type": "application/json" },
      timestamp: new Date(Date.UTC(2026, 9, 12, 9, 2, 0, index)).toISOString(),
      offset: index * 100,
      tabId: 11,
      pageUrl: "https://app.example.com/checkout",
      failure: null,
    }
  })
}

/**
 * An in-memory reader with the same access rule the procedures apply: a
 * report the caller cannot see throws NOT_FOUND.
 */
export function makeReader(input: {
  reports?: Record<string, BugReportDetails>
  events?: Record<string, DebuggerEvents>
  requests?: Record<string, NetworkRequestItem[]>
  bodies?: Record<
    string,
    { requestBody: string | null; responseBody: string | null }
  >
  failWith?: Error
  /** Per report: video length in ms, and whether a capture is attached. */
  captures?: Record<string, { durationMs: number | null; hasCapture?: boolean }>
}): CrikketReader & { calls: string[] } {
  const calls: string[] = []

  const requireReport = (id: string) => {
    if (input.failWith) {
      throw input.failWith
    }

    const report = input.reports?.[id]
    if (!report) {
      throw new ORPCError("NOT_FOUND", { message: "Bug report not found" })
    }
    return report
  }

  // Runs a fake read like a real async call: a throw becomes a rejection.
  const settle = <T>(run: () => T): Promise<T> =>
    new Promise((resolve) => resolve(run()))

  return {
    calls,
    listReports: (listInput) =>
      settle(() => {
        calls.push(`listReports:${JSON.stringify(listInput)}`)
        const items: BugReportListPage["items"] = Object.values(
          input.reports ?? {}
        ).map((report) => ({
          id: report.id,
          title: report.title ?? "Untitled Bug Report",
          description: report.description ?? undefined,
          duration: "1:42",
          thumbnail: undefined,
          attachmentUrl: report.attachmentUrl ?? undefined,
          attachmentType:
            report.attachmentType === "screenshot" ? "screenshot" : "video",
          uploader: { name: "Henry", avatar: undefined },
          visibility: report.visibility,
          status: report.status,
          submissionStatus: "ready",
          debuggerIngestionStatus: "completed",
          debuggerIngestionError: undefined,
          priority: report.priority,
          tags: report.tags,
          url: report.url ?? undefined,
          createdAt: report.createdAt,
          updatedAt: report.updatedAt,
        }))
        return {
          items,
          pagination: {
            page: 1,
            pageSize: 20,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
            totalItems: items.length,
          },
        }
      }),
    getReport: (id) =>
      settle(() => {
        calls.push(`getReport:${id}`)
        return requireReport(id)
      }),
    getDebuggerEvents: (id) =>
      settle(() => {
        calls.push(`getDebuggerEvents:${id}`)
        requireReport(id)
        return input.events?.[id] ?? { actions: [], logs: [] }
      }),
    getNetworkRequestsPage: (pageInput) =>
      settle(() => {
        calls.push(`getNetworkRequestsPage:${pageInput.id}:${pageInput.page}`)
        requireReport(pageInput.id)
        const all = (input.requests?.[pageInput.id] ?? []).filter(
          (request) =>
            (pageInput.tabId === undefined ||
              request.tabId === pageInput.tabId) &&
            (!pageInput.search || request.url.includes(pageInput.search))
        )
        const page = pageInput.page ?? 1
        const perPage = pageInput.perPage ?? 10
        const totalPages = Math.max(1, Math.ceil(all.length / perPage))
        return {
          items: all.slice((page - 1) * perPage, page * perPage),
          pagination: {
            page,
            pageSize: perPage,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1,
            totalItems: all.length,
          },
        }
      }),
    getCaptureSource: (id) =>
      settle(() => {
        calls.push(`getCaptureSource:${id}`)
        const report = requireReport(id)
        const capture = input.captures?.[id]
        return {
          id,
          attachmentType:
            report.attachmentType === "screenshot" ||
            report.attachmentType === "replay"
              ? report.attachmentType
              : ("video" as const),
          captureKey: capture?.hasCapture === false ? null : `capture/${id}`,
          captureContentType:
            report.attachmentType === "screenshot" ? "image/png" : "video/webm",
          captureSizeBytes: 1000,
          durationMs: capture ? capture.durationMs : 60_000,
        }
      }),
    getNetworkRequestBodies: (bodiesInput) =>
      settle(() => {
        calls.push(
          `getNetworkRequestBodies:${bodiesInput.requestIds.join(",")}`
        )
        requireReport(bodiesInput.id)
        return Object.fromEntries(
          bodiesInput.requestIds
            .filter((requestId) => input.bodies?.[requestId])
            .map((requestId) => [
              requestId,
              input.bodies?.[requestId] ?? {
                requestBody: null,
                responseBody: null,
              },
            ])
        )
      }),
    getNetworkRequestDetails: (detailsInput) =>
      settle(() => {
        calls.push(`getNetworkRequestDetails:${detailsInput.requestId}`)
        requireReport(detailsInput.id)
        const request = input.requests?.[detailsInput.id]?.find(
          (item) => item.id === detailsInput.requestId
        )
        if (!request) {
          throw new ORPCError("NOT_FOUND", {
            message: "Network request not found",
          })
        }
        const body = input.bodies?.[detailsInput.requestId]
        return {
          ...request,
          requestBody: body?.requestBody ?? null,
          responseBody: body?.responseBody ?? null,
        }
      }),
  }
}
