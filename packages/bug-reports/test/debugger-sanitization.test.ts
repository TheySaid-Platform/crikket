import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test"

interface InsertedRow {
  [key: string]: unknown
}

const insertedRows: InsertedRow[] = []

mock.module("@crikket/env/server", () => ({
  env: {
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/crikket",
    BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
    BETTER_AUTH_URL: "http://localhost:3000",
    GOOGLE_CLIENT_ID: "dummy",
    GOOGLE_CLIENT_SECRET: "dummy",
    ENABLE_PAYMENTS: "false",
    NODE_ENV: "test",
  },
}))

mock.module("@crikket/db", () => ({
  db: {
    insert: () => ({
      values: (rows: InsertedRow | InsertedRow[]) => {
        const normalizedRows = Array.isArray(rows) ? rows : [rows]
        insertedRows.push(...normalizedRows)
        return Promise.resolve()
      },
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
  },
}))

mock.module("@crikket/shared/lib/errors", () => ({
  reportNonFatalError: () => undefined,
  isErrorWithCode: (error: unknown, code: string) =>
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === code,
}))

let persistBugReportDebuggerData: typeof import("../src/lib/debugger").persistBugReportDebuggerData

beforeAll(async () => {
  ;({ persistBugReportDebuggerData } = await import("../src/lib/debugger"))
})

beforeEach(() => {
  insertedRows.length = 0
})

afterAll(() => {
  mock.restore()
})

describe("persistBugReportDebuggerData", () => {
  it("removes null bytes from text fields before inserting", async () => {
    const bugReportId = "br_123"
    const timestamp = new Date().toISOString()

    const result = await persistBugReportDebuggerData(bugReportId, {
      actions: [
        {
          type: "click\u0000bad",
          target: "button\u0000",
          timestamp,
          offset: 0,
          metadata: {
            nested: { text: "clean\u0000" },
            list: ["clean\u0000"],
          },
        },
      ],
      logs: [
        {
          level: "error",
          message: "Something\u0000failed",
          timestamp,
          offset: 0,
          metadata: {
            value: "clean\u0000",
          },
        },
      ],
      networkRequests: [
        {
          method: "POST\u0000",
          url: "https://example.com/\u0000upload",
          status: 200,
          duration: 42,
          requestHeaders: {},
          responseHeaders: {},
          requestBody: "binary\u0000data",
          responseBody: "ok\u0000",
          timestamp,
          offset: 42,
        },
      ],
    })

    expect(result.warnings).toBeEmpty()
    expect(result.persisted).toEqual({
      actions: 1,
      logs: 1,
      networkRequests: 1,
    })

    const action = insertedRows.find((row) => row.type === "clickbad")
    expect(action?.target).toBe("button")
    expect(action?.metadata).toEqual({
      nested: { text: "clean" },
      list: ["clean"],
    })

    const log = insertedRows.find((row) => row.message === "Somethingfailed")
    expect(log).toBeDefined()

    const request = insertedRows.find(
      (row) => row.url === "https://example.com/upload"
    )
    expect(request?.method).toBe("POST")
    expect(request?.requestBody).toBe("binarydata")
    expect(request?.responseBody).toBe("ok")
  })

  it("stores the source tab of each event and leaves it empty for old reports", async () => {
    const timestamp = new Date().toISOString()

    const result = await persistBugReportDebuggerData("br_456", {
      actions: [
        {
          type: "tab-switch",
          target: "tab",
          timestamp,
          offset: 10,
          tabId: 2,
          pageUrl: "https://accounts.example.com/login",
        },
      ],
      logs: [{ level: "log", message: "legacy log", timestamp, offset: 0 }],
      networkRequests: [
        {
          method: "POST",
          url: "https://accounts.example.com/token",
          timestamp,
          offset: 20,
          tabId: 2,
          pageUrl: "https://accounts.example.com/login",
        },
      ],
    })

    expect(result.warnings).toBeEmpty()

    const action = insertedRows.find((row) => row.type === "tab-switch")
    expect(action).toMatchObject({
      tabId: 2,
      pageUrl: "https://accounts.example.com/login",
    })

    const request = insertedRows.find(
      (row) => row.url === "https://accounts.example.com/token"
    )
    expect(request).toMatchObject({
      tabId: 2,
      pageUrl: "https://accounts.example.com/login",
    })

    const log = insertedRows.find((row) => row.message === "legacy log")
    expect(log).toMatchObject({ tabId: null, pageUrl: null })
  })
})
