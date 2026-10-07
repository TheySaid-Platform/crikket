import { Button } from "@crikket/ui/components/ui/button"
import { GripVertical, Pause, Play } from "lucide-react"
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react"
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

/**
 * The video with a Jam-style trim bar under it: drag the green handles to keep
 * only part of the recording. Playback stays inside the kept part; the video
 * itself is cut when the report is submitted.
 */
export function TrimmableVideo({
  src,
  durationMs,
  trim,
  blurRegions,
  drawings,
  disabled = false,
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
    <div className="space-y-3">
      <div className="flex justify-center overflow-hidden rounded-xl border bg-black shadow-sm">
        <div className="relative inline-block">
          <video
            className="block max-h-[400px] max-w-full cursor-pointer"
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

      <div className="flex items-center gap-3">
        <Button
          aria-label={isPlaying ? "Pause" : "Play"}
          disabled={disabled}
          onClick={togglePlay}
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
          className="relative h-10 flex-1 touch-none select-none rounded-lg bg-muted"
          onPointerDown={handleTrackPointerDown}
          ref={trackRef}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-l-lg bg-foreground/10"
            style={{ width: `${startPercent}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 rounded-r-lg bg-foreground/10"
            style={{ width: `${100 - endPercent}%` }}
          />
          <div
            className="absolute inset-y-0 rounded-md border-2 border-emerald-400 bg-emerald-400/10"
            style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
          />
          <div
            className="pointer-events-none absolute inset-y-1 w-0.5 -translate-x-1/2 rounded bg-foreground"
            style={{ left: `${toPercent(currentMs)}%` }}
          />
          {(["start", "end"] as const).map((side) => (
            <button
              aria-label={side === "start" ? "Trim start" : "Trim end"}
              className="absolute inset-y-0 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-md bg-emerald-400 text-emerald-950 focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed"
              disabled={disabled}
              key={side}
              onKeyDown={handleHandleKeyDown(side)}
              onPointerDown={handleHandlePointerDown(side)}
              style={{
                left: `${side === "start" ? startPercent : endPercent}%`,
              }}
              title="Drag to trim"
              type="button"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      <p className="text-center font-medium text-sm">
        {formatKeptDuration(range.endMs - range.startMs)}
      </p>
    </div>
  )
}
