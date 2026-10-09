import { Button } from "@crikket/ui/components/ui/button"
import { Pause, Play } from "lucide-react"
import { type KeyboardEvent, type PointerEvent, useRef } from "react"
import type { TrimRange } from "@/components/trimmable-video"
import { formatDuration } from "@/lib/utils"
import type { VideoDrawing } from "@/lib/video-edit"

const DRAWING_LANES = 3
const KEY_STEP_MS = 1000

interface VideoTimelineProps {
  durationMs: number
  currentMs: number
  // The kept part of the recording; the rest is greyed out.
  range: TrimRange
  drawings: VideoDrawing[]
  isPlaying: boolean
  disabled: boolean
  onTogglePlay: () => void
  onSeek: (ms: number) => void
}

/** Play button and scrubber, with a colored bar for when each drawing shows. */
export function VideoTimeline({
  durationMs,
  currentMs,
  range,
  drawings,
  isPlaying,
  disabled,
  onTogglePlay,
  onSeek,
}: VideoTimelineProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const toPercent = (ms: number) =>
    durationMs > 0 ? Math.min(100, Math.max(0, (ms / durationMs) * 100)) : 0

  const msFromClientX = (clientX: number): number => {
    const box = trackRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    return ((clientX - box.left) / box.width) * durationMs
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    const track = event.currentTarget
    track.setPointerCapture(event.pointerId)
    onSeek(msFromClientX(event.clientX))

    const onMove = (moveEvent: globalThis.PointerEvent) =>
      onSeek(msFromClientX(moveEvent.clientX))
    const onUp = () => {
      track.removeEventListener("pointermove", onMove)
      track.removeEventListener("pointerup", onUp)
      track.removeEventListener("pointercancel", onUp)
    }
    track.addEventListener("pointermove", onMove)
    track.addEventListener("pointerup", onUp)
    track.addEventListener("pointercancel", onUp)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      { ArrowLeft: -KEY_STEP_MS, ArrowRight: KEY_STEP_MS }[event.key] ?? 0
    if (disabled || step === 0) return
    event.preventDefault()
    onSeek(currentMs + step)
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        aria-label={isPlaying ? "Pause" : "Play"}
        disabled={disabled}
        onClick={onTogglePlay}
        size="icon"
        type="button"
        variant="outline"
      >
        {isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </Button>

      <div
        aria-label="Video position"
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuemin={0}
        aria-valuenow={Math.round(currentMs / 1000)}
        className="relative h-10 flex-1 cursor-pointer touch-none select-none overflow-hidden rounded-lg bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        ref={trackRef}
        role="slider"
        tabIndex={0}
      >
        <div
          className="absolute inset-y-0 left-0 bg-foreground/15"
          style={{ width: `${toPercent(range.startMs)}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-foreground/15"
          style={{ width: `${100 - toPercent(range.endMs)}%` }}
        />
        {drawings.map((drawing, index) => (
          <div
            className="absolute h-1.5 rounded-full shadow-sm ring-1 ring-black/10"
            key={drawing.id}
            style={{
              left: `${toPercent(drawing.startMs)}%`,
              width: `${Math.max(0.8, toPercent(drawing.endMs) - toPercent(drawing.startMs))}%`,
              top: 8 + (index % DRAWING_LANES) * 9,
              backgroundColor:
                drawing.annotation.kind === "blur"
                  ? "#64748b"
                  : drawing.annotation.color,
            }}
          />
        ))}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground"
          style={{ left: `${toPercent(currentMs)}%` }}
        />
      </div>

      <span className="shrink-0 whitespace-nowrap text-right font-mono text-muted-foreground text-xs tabular-nums">
        {formatDuration(Math.max(0, currentMs - range.startMs))} /{" "}
        {formatDuration(range.endMs - range.startMs)}
      </span>
    </div>
  )
}
