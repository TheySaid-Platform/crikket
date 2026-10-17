import { Button } from "@crikket/ui/components/ui/button"
import { Pause, Play } from "lucide-react"
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
  useState,
} from "react"
import { BlurRegionBox } from "@/components/blur-region-box"
import { VideoDrawingsOverlay } from "@/components/video-drawings-overlay"
import { usePlaybackClock } from "@/hooks/use-playback-clock"
import { formatDuration } from "@/lib/utils"
import { primeVideoDuration } from "@/lib/video-duration"
import type { BlurRegion, VideoDrawing } from "@/lib/video-edit"

export interface TrimRange {
  startMs: number
  endMs: number
}

type HandleSide = "start" | "end"

const MIN_CLIP_MS = 500
const KEY_STEP_MS = 100

interface TrimmableVideoProps {
  src: string
  durationMs: number
  // null keeps the whole recording.
  trim: TrimRange | null
  blurRegions: BlurRegion[]
  drawings: VideoDrawing[]
  disabled?: boolean
  // Shown at the end of the row under the trim bar (the edit button).
  trailing?: ReactNode
  // Called when a handle is released, not on every drag step.
  onTrimChange: (trim: TrimRange) => void
}

function formatKeptDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) {
    return seconds === 1 ? "1 second" : `${seconds} seconds`
  }
  return formatDuration(ms)
}

/** Playback stays inside the kept part; the file is only cut on submit. */
export function TrimmableVideo({
  src,
  durationMs,
  trim,
  blurRegions,
  drawings,
  disabled = false,
  trailing,
  onTrimChange,
}: TrimmableVideoProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const isPrimingRef = useRef(false)
  // The range while a handle is being dragged.
  const [draft, setDraft] = useState<TrimRange | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  usePlaybackClock(videoRef, isPlaying, setCurrentMs)

  const committed = trim ?? { startMs: 0, endMs: durationMs }
  const range = draft ?? committed
  const toPercent = (ms: number) =>
    durationMs > 0 ? Math.min(100, Math.max(0, (ms / durationMs) * 100)) : 0

  const seekTo = (ms: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = ms / 1000
    setCurrentMs(ms)
  }

  const msFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return Math.round(ratio * durationMs)
  }

  const moveHandle = (
    side: HandleSide,
    ms: number,
    base: TrimRange
  ): TrimRange =>
    side === "start"
      ? {
          startMs: Math.min(Math.max(0, ms), base.endMs - MIN_CLIP_MS),
          endMs: base.endMs,
        }
      : {
          startMs: base.startMs,
          endMs: Math.max(Math.min(durationMs, ms), base.startMs + MIN_CLIP_MS),
        }

  const handleHandlePointerDown =
    (side: HandleSide) => (event: PointerEvent<HTMLButtonElement>) => {
      if (disabled) return
      event.preventDefault()
      event.stopPropagation()
      const handle = event.currentTarget
      handle.setPointerCapture(event.pointerId)
      videoRef.current?.pause()

      let latest = committed
      const onMove = (moveEvent: globalThis.PointerEvent) => {
        latest = moveHandle(side, msFromClientX(moveEvent.clientX), latest)
        setDraft(latest)
        seekTo(side === "start" ? latest.startMs : latest.endMs)
      }
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove)
        handle.removeEventListener("pointerup", onUp)
        handle.removeEventListener("pointercancel", onUp)
        setDraft(null)
        onTrimChange(latest)
      }
      handle.addEventListener("pointermove", onMove)
      handle.addEventListener("pointerup", onUp)
      handle.addEventListener("pointercancel", onUp)
    }

  const handleHandleKeyDown =
    (side: HandleSide) => (event: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return
      const step =
        { ArrowLeft: -KEY_STEP_MS, ArrowRight: KEY_STEP_MS }[event.key] ?? 0
      if (step === 0) return
      event.preventDefault()
      const position = side === "start" ? committed.startMs : committed.endMs
      const next = moveHandle(side, position + step, committed)
      seekTo(side === "start" ? next.startMs : next.endMs)
      onTrimChange(next)
    }

  const handleTrackPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    const ms = msFromClientX(event.clientX)
    seekTo(Math.min(Math.max(ms, range.startMs), range.endMs))
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) {
      video.pause()
      return
    }
    const ms = video.currentTime * 1000
    if (ms < committed.startMs || ms >= committed.endMs - 50) {
      video.currentTime = committed.startMs / 1000
    }
    video.play().catch(() => undefined)
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (!video || isPrimingRef.current) return
    const ms = video.currentTime * 1000
    setCurrentMs(ms)
    if (!video.paused && ms >= committed.endMs) {
      video.pause()
      video.currentTime = committed.startMs / 1000
    }
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    isPrimingRef.current = true
    primeVideoDuration(video, () => {
      isPrimingRef.current = false
      seekTo(committed.startMs)
    })
  }

  const startPercent = toPercent(range.startMs)
  const endPercent = toPercent(range.endMs)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-[200px] flex-1 items-center justify-center overflow-hidden rounded-[10px] bg-zinc-950">
        <div className="relative inline-block">
          <video
            className="block max-h-[calc(100vh-250px)] max-w-full cursor-pointer"
            onClick={togglePlay}
            onLoadedMetadata={handleLoadedMetadata}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onTimeUpdate={handleTimeUpdate}
            preload="auto"
            ref={videoRef}
            src={src}
          >
            <track kind="captions" />
          </video>
          <div className="pointer-events-none absolute inset-0">
            {blurRegions.map((region) => (
              <BlurRegionBox key={region.id} region={region} />
            ))}
          </div>
          <VideoDrawingsOverlay drawings={drawings} timeMs={currentMs} />
        </div>
      </div>

      <div
        className="relative mt-1 h-7 shrink-0 touch-none select-none rounded-md border bg-muted"
        onPointerDown={handleTrackPointerDown}
        ref={trackRef}
      >
        <div
          className="absolute inset-y-0 rounded-md border-2 border-primary bg-primary/10"
          style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
        />
        <div
          className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded bg-foreground"
          style={{ left: `${toPercent(currentMs)}%` }}
        >
          <span className="absolute -top-2 left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full border border-border bg-background shadow" />
        </div>
        {(["start", "end"] as const).map((side) => (
          <button
            aria-label={side === "start" ? "Trim start" : "Trim end"}
            className="absolute inset-y-0 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-[5px] bg-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1 disabled:cursor-not-allowed"
            disabled={disabled}
            key={side}
            onKeyDown={handleHandleKeyDown(side)}
            onPointerDown={handleHandlePointerDown(side)}
            style={{
              left: `${side === "start" ? startPercent : endPercent}%`,
            }}
            title="Drag to keep only the part that shows the bug"
            type="button"
          >
            <span className="h-2.5 w-0.5 rounded-full bg-white/85" />
          </button>
        ))}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Button
            aria-label={isPlaying ? "Pause" : "Play"}
            disabled={disabled}
            onClick={togglePlay}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <p className="truncate font-mono text-muted-foreground text-xs tabular-nums">
            <span className="text-foreground">
              {formatDuration(range.startMs)} – {formatDuration(range.endMs)}
            </span>{" "}
            · {formatKeptDuration(range.endMs - range.startMs)} of{" "}
            {formatDuration(durationMs)}
          </p>
        </div>
        {trailing}
      </div>
    </div>
  )
}
