import type { DebuggerSessionSnapshot } from "@crikket/capture-core/debugger/types"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { getDebuggerSessionSnapshot } from "@/lib/bug-report-debugger/client"
import { loadLogsBackup } from "@/lib/recording-store"

const LIVE_ATTEMPTS = 3
const RETRY_DELAY_MS = 400

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

// The session as the background worker has it now. The worker can be
// restarting, so a failed request is retried; a null answer is final.
async function loadLiveSnapshot(
  sessionId: string
): Promise<DebuggerSessionSnapshot | null> {
  for (let attempt = 1; attempt <= LIVE_ATTEMPTS; attempt++) {
    try {
      return await getDebuggerSessionSnapshot(sessionId)
    } catch (error) {
      if (attempt === LIVE_ATTEMPTS) {
        reportNonFatalError(
          `Failed to load debugger snapshot for session ${sessionId}`,
          error
        )
        return null
      }
      await delay(RETRY_DELAY_MS)
    }
  }
  return null
}

// Only events up to the stop go in the report. After the stop the live
// session can still take in network requests, which push its oldest events out
// of its capped list, so its total count can hide lost events.
function countReportedEvents(
  snapshot: DebuggerSessionSnapshot,
  stoppedAt: number | null
): number {
  if (stoppedAt === null) return snapshot.events.length
  return snapshot.events.filter((event) => event.timestamp <= stoppedAt).length
}

/**
 * The logs of a capture (actions, console, network). They come from the live
 * session when it is there, and from the copy saved with the capture when the
 * live session was lost or has fewer of the reported events, so a report never
 * goes out without its logs.
 */
export async function loadDebuggerSnapshot(
  sessionId: string
): Promise<DebuggerSessionSnapshot | null> {
  const [live, backup] = await Promise.all([
    loadLiveSnapshot(sessionId),
    loadLogsBackup(sessionId).catch((error: unknown) => {
      reportNonFatalError(
        `Failed to load the saved logs of session ${sessionId}`,
        error
      )
      return null
    }),
  ])

  if (live && backup) {
    const stoppedAt =
      live.recordingStoppedAt ?? backup.recordingStoppedAt ?? null
    return countReportedEvents(live, stoppedAt) >=
      countReportedEvents(backup, stoppedAt)
      ? live
      : { ...backup, recordingStoppedAt: stoppedAt }
  }
  return live ?? backup
}
