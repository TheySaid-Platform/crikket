import { getEventOffset } from "./payload"
import type {
  BugReportDebuggerPayload,
  DebuggerSessionSnapshot,
  RecordingPause,
} from "./types"

export interface DebuggerTrimRange {
  startMs: number
  endMs: number
}

function normalizeRange(range: DebuggerTrimRange): DebuggerTrimRange {
  const startMs = Math.max(0, Math.floor(range.startMs))
  return { startMs, endMs: Math.max(startMs, Math.floor(range.endMs)) }
}

// A request counts while any part of it is in the range: one that started
// before the cut and failed inside it belongs to the kept part.
function overlapsRange(
  offset: number,
  durationMs: number,
  range: DebuggerTrimRange
): boolean {
  return offset <= range.endMs && offset + durationMs >= range.startMs
}

function remap<T extends { offset: number | null }>(
  entries: T[],
  range: DebuggerTrimRange,
  getDurationMs: (entry: T) => number
): T[] {
  const kept: T[] = []
  for (const entry of entries) {
    // Events from before the recording started have no place in the video.
    if (entry.offset === null) {
      kept.push(entry)
    } else if (overlapsRange(entry.offset, getDurationMs(entry), range)) {
      kept.push({ ...entry, offset: Math.max(0, entry.offset - range.startMs) })
    }
  }
  return kept
}

const noDuration = () => 0

// Events outside the kept range are dropped; the rest shift so offset 0 is
// the first frame of the trimmed clip.
export function trimDebuggerPayload(
  payload: BugReportDebuggerPayload,
  range: DebuggerTrimRange
): BugReportDebuggerPayload {
  const kept = normalizeRange(range)
  return {
    actions: remap(payload.actions, kept, noDuration),
    logs: remap(payload.logs, kept, noDuration),
    networkRequests: remap(payload.networkRequests, kept, (request) =>
      Math.max(0, request.duration ?? 0)
    ),
  }
}

// The snapshot events a trimmed report keeps, for what is worked out from
// them (the suggested title, the first page).
export function trimDebuggerSnapshot(
  snapshot: DebuggerSessionSnapshot,
  range: DebuggerTrimRange,
  pauses: readonly RecordingPause[] = []
): DebuggerSessionSnapshot {
  const kept = normalizeRange(range)
  const anchorTimestamp = snapshot.recordingStartedAt ?? snapshot.startedAt
  return {
    ...snapshot,
    events: snapshot.events.filter((event) => {
      const offset = getEventOffset(event.timestamp, anchorTimestamp, pauses)
      if (offset === null) return true
      const durationMs =
        event.kind === "network" ? Math.max(0, event.duration ?? 0) : 0
      return overlapsRange(offset, durationMs, kept)
    }),
  }
}
