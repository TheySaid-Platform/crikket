// How long a new drawing shows on the video.
const DEFAULT_SHOW_FOR_MS = 3000
// A drawing added at the very end of the kept part still shows this long.
const MIN_SHOW_FOR_MS = 1000

export interface TimeRange {
  startMs: number
  endMs: number
}

// Playback stops at the end of the kept part, so a drawing made there starts
// a second earlier; otherwise it would show for no time.
export function getDrawingTiming(
  currentMs: number,
  range: TimeRange,
  showForMs = DEFAULT_SHOW_FOR_MS
): TimeRange {
  const latestStart = Math.max(range.startMs, range.endMs - MIN_SHOW_FOR_MS)
  const startMs = Math.round(
    Math.min(Math.max(currentMs, range.startMs), latestStart)
  )
  const endMs = Math.max(
    startMs + 1,
    Math.min(range.endMs, startMs + showForMs)
  )
  return { startMs, endMs }
}
