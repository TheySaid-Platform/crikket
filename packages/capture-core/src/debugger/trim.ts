import type { BugReportDebuggerPayload } from "./types"

export interface DebuggerTrimRange {
  startMs: number
  endMs: number
}

// Returns the event's new offset, or null to drop the event.
type OffsetMapper = (offset: number) => number | null

function remapOffsets(
  payload: BugReportDebuggerPayload,
  mapOffset: OffsetMapper
): BugReportDebuggerPayload {
  const remap = <T extends { offset: number | null }>(entries: T[]): T[] => {
    const kept: T[] = []
    for (const entry of entries) {
      // Events captured before the recording started have no video position.
      if (entry.offset === null) {
        kept.push(entry)
        continue
      }
      const offset = mapOffset(entry.offset)
      if (offset !== null) {
        kept.push({ ...entry, offset })
      }
    }
    return kept
  }

  return {
    actions: remap(payload.actions),
    logs: remap(payload.logs),
    networkRequests: remap(payload.networkRequests),
  }
}

/**
 * Re-aligns debugger events with a trimmed video. Events outside the kept
 * range are dropped and the rest are shifted so offset 0 matches the first
 * frame of the trimmed clip.
 */
export function trimDebuggerPayload(
  payload: BugReportDebuggerPayload,
  range: DebuggerTrimRange
): BugReportDebuggerPayload {
  const startMs = Math.max(0, Math.floor(range.startMs))
  const endMs = Math.max(startMs, Math.floor(range.endMs))

  return remapOffsets(payload, (offset) =>
    offset < startMs || offset > endMs ? null : offset - startMs
  )
}
