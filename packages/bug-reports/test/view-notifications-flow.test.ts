import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test"

const column = (name: string) => ({ __column: name })

const bugReportView = {
  __table: "bugReportView",
  id: column("id"),
  notifiedAt: column("notifiedAt"),
  notifyAttempts: column("notifyAttempts"),
  nextNotifyAttemptAt: column("nextNotifyAttemptAt"),
}

const member = {
  __table: "member",
  organizationId: column("organizationId"),
  userId: column("userId"),
}

type Column = { __column: string }

type Condition =
  | { op: "eq" | "lt" | "lte"; column: Column; value: unknown }
  | { op: "isNull"; column: Column }
  | { op: "and"; conditions: Condition[] }

type SqlExpr = { op: "sql"; strings: string[] }

type ViewRow = {
  id: string
  bugReportId: string
  viewerKey: string
  viewerUserId: string | null
  notifiedAt: Date | null
  notifyAttempts: number
  nextNotifyAttemptAt: Date
  lastNotifyError: string | null
}

type User = { id: string; name: string; email: string }

const state = {
  views: new Map<string, ViewRow>(),
  reports: new Map<
    string,
    { id: string; organizationId: string; title: string; reporterId: string }
  >(),
  users: new Map<string, User>(),
  members: [] as { organizationId: string; userId: string }[],
  sent: [] as Record<string, string>[],
  failSends: 0,
}

function resetState(): void {
  state.views = new Map()
  state.reports = new Map([
    [
      "report_1",
      {
        id: "report_1",
        organizationId: "org_1",
        title: "Login button does nothing",
        reporterId: "reporter",
      },
    ],
  ])
  state.users = new Map([
    [
      "reporter",
      { id: "reporter", name: "Rita Reporter", email: "rita@theysaid.io" },
    ],
    ["viewer", { id: "viewer", name: "Ada Obi", email: "ada@theysaid.io" }],
  ])
  state.members = [
    { organizationId: "org_1", userId: "reporter" },
    { organizationId: "org_1", userId: "viewer" },
  ]
  state.sent = []
  state.failSends = 0
}

function addView(overrides: Partial<ViewRow> = {}): ViewRow {
  const row: ViewRow = {
    id: `view_${state.views.size + 1}`,
    bugReportId: "report_1",
    viewerKey: "user:viewer",
    viewerUserId: "viewer",
    notifiedAt: null,
    notifyAttempts: 0,
    nextNotifyAttemptAt: new Date(Date.now() - 1000),
    lastNotifyError: null,
    ...overrides,
  }
  state.views.set(row.id, row)
  return row
}

function makeDue(row: ViewRow): void {
  row.nextNotifyAttemptAt = new Date(Date.now() - 1000)
}

function evalCondition(
  row: Record<string, unknown>,
  condition: Condition
): boolean {
  if (condition.op === "and") {
    return condition.conditions.every((inner) => evalCondition(row, inner))
  }

  const value = row[condition.column.__column]

  if (condition.op === "isNull") {
    return value === null
  }

  if (condition.op === "eq") {
    return value === condition.value
  }

  const left = value instanceof Date ? value.getTime() : Number(value)
  const right =
    condition.value instanceof Date
      ? condition.value.getTime()
      : Number(condition.value)

  return condition.op === "lt" ? left < right : left <= right
}

function applySet(row: ViewRow, setValue: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(setValue)) {
    const isIncrement =
      key === "notifyAttempts" &&
      typeof value === "object" &&
      value !== null &&
      (value as SqlExpr).op === "sql" &&
      (value as SqlExpr).strings.join("").includes("+ 1")

    if (isIncrement) {
      row.notifyAttempts += 1
      continue
    }

    ;(row as Record<string, unknown>)[key] = value
  }
}

mock.module("@crikket/db/schema/bug-report", () => ({ bugReportView }))
mock.module("@crikket/db/schema/auth", () => ({ member }))

mock.module("drizzle-orm", () => ({
  and: (...conditions: Condition[]): Condition => ({ op: "and", conditions }),
  asc: (target: Column) => target,
  eq: (target: Column, value: unknown): Condition => ({
    op: "eq",
    column: target,
    value,
  }),
  isNull: (target: Column): Condition => ({ op: "isNull", column: target }),
  lt: (target: Column, value: unknown): Condition => ({
    op: "lt",
    column: target,
    value,
  }),
  lte: (target: Column, value: unknown): Condition => ({
    op: "lte",
    column: target,
    value,
  }),
  sql: (strings: TemplateStringsArray): SqlExpr => ({
    op: "sql",
    strings: [...strings],
  }),
}))

mock.module("@crikket/db", () => ({
  db: {
    update: () => ({
      set: (setValue: Record<string, unknown>) => ({
        where: (condition: Condition) => {
          const updated = [...state.views.values()].filter((row) =>
            evalCondition(row as Record<string, unknown>, condition)
          )
          for (const row of updated) {
            applySet(row, setValue)
          }

          return {
            returning: () =>
              Promise.resolve(
                updated.map((row) => ({ attempts: row.notifyAttempts }))
              ),
            // biome-ignore lint/suspicious/noThenProperty: mimics an awaitable drizzle query
            then: (resolve: (value: undefined) => void) => resolve(undefined),
          }
        },
      }),
    }),
    query: {
      bugReportView: {
        findMany: (input: { where: Condition; limit: number }) =>
          Promise.resolve(
            [...state.views.values()]
              .filter((row) =>
                evalCondition(row as Record<string, unknown>, input.where)
              )
              .slice(0, input.limit)
              .map((row) => ({ id: row.id }))
          ),
        findFirst: (input: { where: Condition }) => {
          const row = [...state.views.values()].find((view) =>
            evalCondition(view as Record<string, unknown>, input.where)
          )
          if (!row) {
            return Promise.resolve(undefined)
          }

          const report = state.reports.get(row.bugReportId)
          const viewer = row.viewerUserId
            ? state.users.get(row.viewerUserId)
            : undefined
          const reporter = report
            ? state.users.get(report.reporterId)
            : undefined

          return Promise.resolve({
            ...row,
            viewer: viewer ? { name: viewer.name, email: viewer.email } : null,
            bugReport: {
              id: report?.id,
              organizationId: report?.organizationId,
              title: report?.title,
              reporter: reporter
                ? { id: reporter.id, email: reporter.email }
                : null,
            },
          })
        },
      },
      member: {
        findFirst: (input: { where: Condition }) =>
          Promise.resolve(
            state.members.find((row) =>
              evalCondition(row as Record<string, unknown>, input.where)
            )
              ? { id: "member" }
              : undefined
          ),
      },
    },
  },
}))

mock.module("@crikket/auth/lib/email/index", () => ({
  sendBugReportViewedEmail: (input: Record<string, string>) => {
    if (state.failSends > 0) {
      state.failSends -= 1
      return Promise.reject(new Error("Resend is down"))
    }

    state.sent.push(input)
    return Promise.resolve()
  },
}))

let runBugReportViewNotificationPass: typeof import("../src/lib/view-notifications").runBugReportViewNotificationPass

beforeAll(async () => {
  ;({ runBugReportViewNotificationPass } = await import(
    "../src/lib/view-notifications"
  ))
})

beforeEach(() => {
  resetState()
})

afterAll(() => {
  mock.restore()
})

describe("runBugReportViewNotificationPass", () => {
  it("emails the reporter who opened the report and marks it sent", async () => {
    const row = addView()

    expect(await runBugReportViewNotificationPass()).toEqual({
      failed: 0,
      sent: 1,
      skipped: 0,
    })
    expect(state.sent).toEqual([
      {
        email: "rita@theysaid.io",
        reportId: "report_1",
        reportTitle: "Login button does nothing",
        viewerDescription: "Ada Obi (ada@theysaid.io)",
      },
    ])
    expect(row.notifyAttempts).toBe(1)
    expect(row.notifiedAt).toBeInstanceOf(Date)

    expect(await runBugReportViewNotificationPass()).toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    })
  })

  it("stores the error and retries a failed send later", async () => {
    const row = addView()
    state.failSends = 1
    const before = Date.now()

    expect(await runBugReportViewNotificationPass()).toEqual({
      failed: 1,
      sent: 0,
      skipped: 0,
    })
    expect(row.notifiedAt).toBeNull()
    expect(row.lastNotifyError).toBe("Resend is down")
    expect(row.nextNotifyAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + 60_000
    )

    // Not due yet, so the next pass leaves it alone.
    expect(await runBugReportViewNotificationPass()).toEqual({
      failed: 0,
      sent: 0,
      skipped: 0,
    })

    makeDue(row)
    expect(await runBugReportViewNotificationPass()).toEqual({
      failed: 0,
      sent: 1,
      skipped: 0,
    })
    expect(row.notifyAttempts).toBe(2)
    expect(row.lastNotifyError).toBeNull()
  })

  it("stops retrying after the fifth failure", async () => {
    const row = addView()
    state.failSends = 99

    for (let pass = 0; pass < 7; pass++) {
      makeDue(row)
      await runBugReportViewNotificationPass()
    }

    expect(row.notifyAttempts).toBe(5)
    expect(row.notifiedAt).toBeNull()
    expect(state.failSends).toBe(94)
  })

  it("skips a reporter who left the organization and marks it done", async () => {
    const row = addView()
    state.members = state.members.filter((m) => m.userId !== "reporter")

    expect(await runBugReportViewNotificationPass()).toEqual({
      failed: 0,
      sent: 0,
      skipped: 1,
    })
    expect(state.sent).toEqual([])
    expect(row.notifiedAt).toBeInstanceOf(Date)
  })

  it("sends once when two servers run the pass at the same time", async () => {
    addView()

    const results = await Promise.all([
      runBugReportViewNotificationPass(),
      runBugReportViewNotificationPass(),
    ])

    expect(state.sent).toHaveLength(1)
    expect(results.map((result) => result.sent).sort()).toEqual([0, 1])
  })
})
