import type { DebuggerSessionSnapshot } from "@crikket/capture-core/debugger/types"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { getDebuggerSessionSnapshot } from "@/lib/bug-report-debugger/client"
import { loadLogsBackup } from "@/lib/recording-store"
import { pickReportSnapshot } from "@/lib/report-snapshot"
import { delay } from "@/lib/utils"

const LIVE_ATTEMPTS = 3
const RETRY_DELAY_MS = 400

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

// The live session's logs, or the copy saved at stop if it holds more of the
// events that go in the report.
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
  return pickReportSnapshot(live, backup)
}
