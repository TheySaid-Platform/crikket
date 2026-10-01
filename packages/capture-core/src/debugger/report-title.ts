import type { DebuggerEvent, DebuggerSessionSnapshot } from "./types"

// A report title and page picked from what happened during the recording,
// with plain rules instead of AI:
// - The first uncaught error, or failing request to the page's own site,
//   names the problem: "TypeError: x is undefined on Checkout (shop.com)".
// - Otherwise the title is the page the user last interacted with, which is
//   usually where they reproduced the bug.

export interface ReportPage {
  url: string
  title?: string
}

const MAX_TITLE_LENGTH = 150
const MAX_ISSUE_LENGTH = 90
const MAX_PAGE_TITLE_LENGTH = 50
// Split points in titles like "Inbox (3) - you@x.com - Mail".
const TITLE_SEPARATOR = /\s+[-–—|·•]\s+/
const UNCAUGHT_IN_PROMISE_PREFIX = /^Uncaught \(in promise\)\s*/
const UNCAUGHT_PREFIX = /^Uncaught\s*/
const TRAILING_LOCATION = /\s*\(https?:\/\/\S+\)$/

type ActionEvent = Extract<DebuggerEvent, { kind: "action" }>
type NetworkEvent = Extract<DebuggerEvent, { kind: "network" }>

export function suggestReportTitle(
  snapshot: DebuggerSessionSnapshot
): string | null {
  const issue = findIssue(snapshot.events)
  const pageUrl = issue?.pageUrl ?? findLastInteractedPage(snapshot.events)
  const pageName = pageUrl ? describePage(snapshot, pageUrl) : null

  if (issue) {
    return truncate(
      pageName ? `${issue.label} on ${pageName}` : issue.label,
      MAX_TITLE_LENGTH
    )
  }

  return pageName ? truncate(pageName, MAX_TITLE_LENGTH) : null
}

// The first web page of the recording, for reports started on a new-tab or
// other browser page.
export function findFirstReportPage(
  snapshot: DebuggerSessionSnapshot
): ReportPage | null {
  const firstEventPage = snapshot.events.find(
    (event) => event.pageUrl && isWebUrl(event.pageUrl)
  )?.pageUrl
  const firstTab = snapshot.tabs.find((tab) => tab.url && isWebUrl(tab.url))
  const url = firstEventPage ?? firstTab?.url
  if (!url) {
    return null
  }

  return { url, title: findPageTitle(snapshot, url) }
}

function findIssue(
  events: DebuggerEvent[]
): { label: string; pageUrl?: string } | null {
  for (const event of events) {
    if (event.kind === "console" && event.message.startsWith("Uncaught")) {
      const firstLine = event.message.split("\n")[0] ?? event.message
      const label = firstLine
        .replace(UNCAUGHT_IN_PROMISE_PREFIX, "")
        .replace(UNCAUGHT_PREFIX, "")
        .replace(TRAILING_LOCATION, "")
      return {
        label: truncate(label, MAX_ISSUE_LENGTH),
        pageUrl: event.pageUrl,
      }
    }
  }

  const failedRequest = events.find(
    (event): event is NetworkEvent =>
      event.kind === "network" && isRelevantFailure(event)
  )
  if (failedRequest) {
    const reason = failedRequest.failure ?? String(failedRequest.status)
    return {
      label: truncate(
        `${failedRequest.method} ${getPath(failedRequest.url)} failed (${reason})`,
        MAX_ISSUE_LENGTH
      ),
      pageUrl: failedRequest.pageUrl,
    }
  }

  return null
}

// Failed calls to the page's own site. Third-party failures (analytics,
// logging, ads) are too common to name a bug after.
function isRelevantFailure(event: NetworkEvent): boolean {
  if (event.method === "OPTIONS" || event.failure === "net::ERR_ABORTED") {
    return false
  }

  const failed =
    Boolean(event.failure) ||
    (typeof event.status === "number" && event.status >= 400)
  if (!(failed && event.pageUrl)) {
    return false
  }

  const requestSite = getSite(event.url)
  return (
    requestSite !== null &&
    requestSite === getSite(event.pageUrl) &&
    !getPath(event.url).endsWith("/favicon.ico")
  )
}

function findLastInteractedPage(events: DebuggerEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (
      event?.kind === "action" &&
      event.actionType !== "tab-switch" &&
      event.actionType !== "navigation" &&
      event.pageUrl &&
      isWebUrl(event.pageUrl)
    ) {
      return event.pageUrl
    }
  }

  return null
}

function describePage(
  snapshot: DebuggerSessionSnapshot,
  pageUrl: string
): string | null {
  const host = getHost(pageUrl)
  if (!host) {
    return null
  }

  const title = findPageTitle(snapshot, pageUrl)
  return title
    ? `${shortenPageTitle(title)} (${host})`
    : `${host}${getPath(pageUrl)}`
}

// The page's title as recorded by navigation steps, or the tab's title if the
// tab is still on that page.
function findPageTitle(
  snapshot: DebuggerSessionSnapshot,
  pageUrl: string
): string | undefined {
  for (let index = snapshot.events.length - 1; index >= 0; index -= 1) {
    const event = snapshot.events[index]
    if (
      event?.kind === "action" &&
      event.actionType === "navigation" &&
      event.pageUrl === pageUrl
    ) {
      const title = getMetadataTitle(event)
      if (title) {
        return title
      }
    }
  }

  return snapshot.tabs.find((tab) => tab.url === pageUrl)?.title
}

function getMetadataTitle(event: ActionEvent): string | undefined {
  const title = event.metadata?.title
  return typeof title === "string" && title.trim() ? title.trim() : undefined
}

function shortenPageTitle(title: string): string {
  const firstPart = title.split(TITLE_SEPARATOR)[0]?.trim() || title
  return truncate(firstPart, MAX_PAGE_TITLE_LENGTH)
}

function isWebUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://")
}

function getHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function getPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

// Last two labels of the host, e.g. "theysaid.io" for "app.theysaid.io".
function getSite(url: string): string | null {
  const host = getHost(url)?.split(":")[0]
  if (!host) {
    return null
  }

  return host.split(".").slice(-2).join(".")
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1).trimEnd()}…`
}
