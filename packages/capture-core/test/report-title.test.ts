import { describe, expect, it } from "bun:test"

import {
  findFirstReportPage,
  suggestReportTitle,
} from "../src/debugger/report-title"
import type {
  DebuggerEvent,
  DebuggerSessionSnapshot,
} from "../src/debugger/types"

const snapshotWith = (
  events: DebuggerEvent[],
  tabs: DebuggerSessionSnapshot["tabs"] = []
): DebuggerSessionSnapshot => ({
  sessionId: "s",
  captureTabId: 1,
  captureType: "video",
  startedAt: 0,
  recordingStartedAt: 0,
  tabs,
  events,
})

const APP = "https://app.theysaid.io/projects"
const navigation = (pageUrl: string, title: string): DebuggerEvent => ({
  kind: "action",
  timestamp: 1,
  actionType: "navigation",
  target: "window",
  metadata: { title },
  tabId: 1,
  pageUrl,
})
const click = (pageUrl: string, timestamp = 2): DebuggerEvent => ({
  kind: "action",
  timestamp,
  actionType: "click",
  target: "button",
  tabId: 1,
  pageUrl,
})

describe("report title suggestions", () => {
  it("names the first uncaught error and the page it happened on", () => {
    const title = suggestReportTitle(
      snapshotWith([
        navigation(APP, "Projects – TheySaid"),
        {
          kind: "console",
          timestamp: 3,
          level: "error",
          message:
            "Uncaught TypeError: Cannot read properties of undefined (reading 'id')\n    at app.js:1:2 (https://app.theysaid.io/app.js:1:2)",
          pageUrl: APP,
        },
      ])
    )

    expect(title).toBe(
      "TypeError: Cannot read properties of undefined (reading 'id') on Projects (app.theysaid.io)"
    )
  })

  it("names a failing request to the page's own site, not third parties", () => {
    const title = suggestReportTitle(
      snapshotWith([
        navigation(APP, "Projects – TheySaid"),
        {
          kind: "network",
          timestamp: 2,
          method: "POST",
          url: "https://play.google.com/log",
          status: 0,
          failure: "net::ERR_FAILED",
          pageUrl: APP,
        },
        {
          kind: "network",
          timestamp: 3,
          method: "GET",
          url: "https://api.theysaid.io/v1/projects?page=2",
          status: 401,
          pageUrl: APP,
        },
      ])
    )

    expect(title).toBe(
      "GET /v1/projects failed (401) on Projects (app.theysaid.io)"
    )
  })

  it("falls back to the page the user last interacted with", () => {
    const mail = "https://mail.google.com/mail/u/0/"
    const title = suggestReportTitle(
      snapshotWith([
        navigation(APP, "Projects – TheySaid"),
        click(APP),
        navigation(mail, "Inbox (845) - henry@theysaid.io - Theysaid Mail"),
        click(mail, 5),
      ])
    )

    expect(title).toBe("Inbox (845) (mail.google.com)")
  })

  it("returns null when nothing happened on a web page", () => {
    expect(suggestReportTitle(snapshotWith([]))).toBeNull()
  })

  it("finds the first web page when recording started on a browser page", () => {
    const page = findFirstReportPage(
      snapshotWith(
        [navigation("https://www.theysaid.io/", "TheySaid"), click(APP)],
        [{ tabId: 1, joinedAt: 0 }]
      )
    )

    expect(page).toEqual({ url: "https://www.theysaid.io/", title: "TheySaid" })
  })
})
