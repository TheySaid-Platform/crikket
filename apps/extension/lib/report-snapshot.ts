import type { DebuggerSessionSnapshot } from "@crikket/capture-core/debugger/types"

// Only events up to the stop go in the report, so only those are compared.
function countReportedEvents(
  snapshot: DebuggerSessionSnapshot,
  stoppedAt: number | null
): number {
  if (stoppedAt === null) return snapshot.events.length
  return snapshot.events.filter((event) => event.timestamp <= stoppedAt).length
}

// The live snapshot, or the copy saved at stop if it holds more of the
// reported events.
export function pickReportSnapshot(
  live: DebuggerSessionSnapshot | null,
  backup: DebuggerSessionSnapshot | null
): DebuggerSessionSnapshot | null {
  if (!(live && backup)) return live ?? backup
  const stoppedAt = live.recordingStoppedAt ?? backup.recordingStoppedAt ?? null
  return countReportedEvents(live, stoppedAt) >=
    countReportedEvents(backup, stoppedAt)
    ? live
    : { ...backup, recordingStoppedAt: stoppedAt }
}
