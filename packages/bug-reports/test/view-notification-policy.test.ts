import { describe, expect, it } from "bun:test"
import {
  ANONYMOUS_VIEWER_KEY,
  calculateBugReportViewNotificationRetryDelayMs,
  describeBugReportTitle,
  describeBugReportViewer,
  getBugReportViewerKey,
  shouldRecordBugReportView,
} from "../src/lib/view-notification-policy"

const LINE_BREAK_OR_BIDI_PATTERN = /[\r\n\u202e]/

describe("bug report view notification policy", () => {
  it("keys signed-in viewers by user and groups signed-out viewers", () => {
    expect(getBugReportViewerKey("user_1")).toBe("user:user_1")
    expect(getBugReportViewerKey(undefined)).toBe(ANONYMOUS_VIEWER_KEY)
  })

  it("records views by other people only", () => {
    expect(
      shouldRecordBugReportView({
        reporterId: "a",
        submissionStatus: "ready",
        viewerUserId: "b",
      })
    ).toBeTrue()
    expect(
      shouldRecordBugReportView({
        reporterId: "a",
        submissionStatus: "ready",
        viewerUserId: undefined,
      })
    ).toBeTrue()
  })

  it("ignores the reporter's own views", () => {
    expect(
      shouldRecordBugReportView({
        reporterId: "a",
        submissionStatus: "ready",
        viewerUserId: "a",
      })
    ).toBeFalse()
  })

  it("ignores reports with no reporter to notify", () => {
    expect(
      shouldRecordBugReportView({
        reporterId: null,
        submissionStatus: "ready",
        viewerUserId: "b",
      })
    ).toBeFalse()
  })

  it("ignores views before the report is ready", () => {
    for (const submissionStatus of ["processing", "failed"]) {
      expect(
        shouldRecordBugReportView({
          reporterId: "a",
          submissionStatus,
          viewerUserId: "b",
        })
      ).toBeFalse()
    }
  })

  it("names the viewer with name and email", () => {
    expect(
      describeBugReportViewer({
        viewerKey: "user:b",
        viewer: { name: "Ada Obi", email: "ada@theysaid.io" },
      })
    ).toBe("Ada Obi (ada@theysaid.io)")
  })

  it("keeps the viewer name to one short line", () => {
    const description = describeBugReportViewer({
      viewerKey: "user:b",
      viewer: {
        name: `Ada\r\nBcc: x\u202e${"y".repeat(200)}`,
        email: "a@x.io",
      },
    })
    expect(description).not.toMatch(LINE_BREAK_OR_BIDI_PATTERN)
    expect(description.startsWith("Ada Bcc: x y")).toBeTrue()
    expect(description.endsWith("… (a@x.io)")).toBeTrue()
    expect(description.length).toBe(80 + " (a@x.io)".length)
  })

  it("falls back to the email when the name is empty", () => {
    expect(
      describeBugReportViewer({
        viewerKey: "user:b",
        viewer: { name: " \n ", email: "ada@theysaid.io" },
      })
    ).toBe("ada@theysaid.io")
  })

  it("keeps the report title to one short line", () => {
    expect(describeBugReportTitle("Login\r\nbroken  again")).toBe(
      "Login broken again"
    )
    expect(describeBugReportTitle("x".repeat(300)).length).toBe(120)
    expect(describeBugReportTitle("   ")).toBe("Untitled bug report")
    expect(describeBugReportTitle(null)).toBe("Untitled bug report")
  })

  it("describes signed-out and deleted viewers", () => {
    expect(
      describeBugReportViewer({ viewerKey: ANONYMOUS_VIEWER_KEY, viewer: null })
    ).toBe("Someone who was not signed in")
    expect(
      describeBugReportViewer({ viewerKey: "user:gone", viewer: null })
    ).toBe("A former Crikket user")
  })

  it("backs off exponentially and caps the retry delay", () => {
    expect(calculateBugReportViewNotificationRetryDelayMs(1)).toBe(60_000)
    expect(calculateBugReportViewNotificationRetryDelayMs(2)).toBe(120_000)
    expect(calculateBugReportViewNotificationRetryDelayMs(20)).toBe(3_600_000)
  })
})
