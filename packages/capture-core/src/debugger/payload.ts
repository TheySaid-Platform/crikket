import type {
  BugReportDebuggerPayload,
  DebuggerSessionSnapshot,
  RecordingPause,
} from "./types"

export function hasDebuggerPayloadData(
  payload: BugReportDebuggerPayload
): boolean {
  return (
    payload.actions.length > 0 ||
    payload.logs.length > 0 ||
    payload.networkRequests.length > 0
  )
}

// True while the recording was paused. The video has nothing from then, so
// neither does the report.
export function isDuringPause(
  timestamp: number,
  pauses: readonly RecordingPause[]
): boolean {
  return pauses.some(
    (pause) => timestamp > pause.pausedAt && timestamp < pause.resumedAt
  )
}

export function buildDebuggerSubmissionPayload(
  snapshot: DebuggerSessionSnapshot,
  pauses: readonly RecordingPause[] = []
): BugReportDebuggerPayload {
  const anchorTimestamp = snapshot.recordingStartedAt ?? snapshot.startedAt
  const stoppedAt = snapshot.recordingStoppedAt ?? null
  // What happens while the user fills in the form is not part of the bug.
  const events = snapshot.events
    .filter((event) => stoppedAt === null || event.timestamp <= stoppedAt)
    .filter((event) => !isDuringPause(event.timestamp, pauses))
    .sort((a, b) => a.timestamp - b.timestamp)

  const payload: BugReportDebuggerPayload = {
    actions: [],
    logs: [],
    networkRequests: [],
  }

  for (const event of events) {
    const timestamp = new Date(event.timestamp).toISOString()
    // The video skips paused time, so later events move back by it.
    const offset = toOffset(
      event.timestamp - getPausedTimeBefore(event.timestamp, pauses),
      anchorTimestamp
    )
    const tabContext = { tabId: event.tabId, pageUrl: event.pageUrl }

    if (event.kind === "action") {
      payload.actions.push({
        type: event.actionType,
        target: event.target,
        timestamp,
        offset,
        metadata: event.metadata,
        ...tabContext,
      })
      continue
    }

    if (event.kind === "console") {
      payload.logs.push({
        level: event.level,
        message: event.message,
        timestamp,
        offset,
        metadata: event.metadata,
        ...tabContext,
      })
      continue
    }

    payload.networkRequests.push({
      method: event.method,
      url: event.url,
      status: event.status,
      duration: event.duration,
      requestHeaders: event.requestHeaders,
      responseHeaders: event.responseHeaders,
      requestBody: event.requestBody,
      responseBody: event.responseBody,
      failure: event.failure,
      timestamp,
      offset,
      ...tabContext,
    })
  }

  return payload
}

function getPausedTimeBefore(
  timestamp: number,
  pauses: readonly RecordingPause[]
): number {
  let pausedMs = 0
  for (const pause of pauses) {
    if (timestamp >= pause.resumedAt) {
      pausedMs += pause.resumedAt - pause.pausedAt
    }
  }
  return pausedMs
}

function toOffset(
  eventTimestamp: number,
  anchorTimestamp: number
): number | null {
  const rawOffset = Math.floor(eventTimestamp - anchorTimestamp)
  return rawOffset >= 0 ? rawOffset : null
}
