export const ANONYMOUS_VIEWER_KEY = "anon"

const BUG_REPORT_VIEW_NOTIFICATION_BASE_DELAY_MS = 60_000
const BUG_REPORT_VIEW_NOTIFICATION_MAX_DELAY_MS = 60 * 60 * 1000
export const BUG_REPORT_VIEW_NOTIFICATION_MAX_ATTEMPTS = 5
const MAX_VIEWER_NAME_LENGTH = 80

/**
 * Signed-out viewers share one key, so a public link opened by many people
 * sends the reporter one email, not one per visit.
 */
export function getBugReportViewerKey(viewerUserId?: string): string {
  return viewerUserId ? `user:${viewerUserId}` : ANONYMOUS_VIEWER_KEY
}

export function shouldRecordBugReportView(input: {
  reporterId: string | null
  viewerUserId?: string
}): boolean {
  return Boolean(input.reporterId) && input.reporterId !== input.viewerUserId
}

export function calculateBugReportViewNotificationRetryDelayMs(
  attempts: number
): number {
  const exponent = Math.max(0, attempts - 1)
  const delay = BUG_REPORT_VIEW_NOTIFICATION_BASE_DELAY_MS * 2 ** exponent
  return Math.min(delay, BUG_REPORT_VIEW_NOTIFICATION_MAX_DELAY_MS)
}

export function describeBugReportViewer(input: {
  viewerKey: string
  viewer: { name: string; email: string } | null
}): string {
  if (input.viewer) {
    return `${cleanViewerName(input.viewer.name)} (${input.viewer.email})`
  }

  return input.viewerKey === ANONYMOUS_VIEWER_KEY
    ? "Someone who was not signed in"
    : "A former Crikket user"
}

// The name is set by the viewer and lands in the email subject, so keep it
// to one short line.
function cleanViewerName(name: string): string {
  const singleLine = name.replace(/[\p{Cc}\p{Cf}]+/gu, " ").trim()
  return singleLine.length > MAX_VIEWER_NAME_LENGTH
    ? `${singleLine.slice(0, MAX_VIEWER_NAME_LENGTH - 1)}…`
    : singleLine
}
