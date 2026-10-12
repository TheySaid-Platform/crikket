import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react"
import { AnnotationTextInput } from "@/components/annotation-text-input"
import { AnnotationToolbar } from "@/components/annotation-toolbar"
import { BlurRegionBox } from "@/components/blur-region-box"
import { EditorFooter } from "@/components/editor-footer"
import type { TrimRange } from "@/components/trimmable-video"
import { VideoDrawingsOverlay } from "@/components/video-drawings-overlay"
import { VideoEditList } from "@/components/video-edit-list"
import { VideoTimeline } from "@/components/video-timeline"
import { useAnnotationDrawing } from "@/hooks/use-annotation-drawing"
import type { VideoOverlays } from "@/hooks/use-capture-edits"
import { usePlaybackClock } from "@/hooks/use-playback-clock"
import { useUndoable } from "@/hooks/use-undoable"
import {
  type Annotation,
  type AnnotationTool,
  DEFAULT_ANNOTATION_COLOR,
  fontSizeFor,
  type Point,
} from "@/lib/annotations"
import { getDrawingTiming } from "@/lib/drawing-timing"
import type { PixelRect } from "@/lib/pixelate"
import { clamp } from "@/lib/utils"
import { primeVideoDuration } from "@/lib/video-duration"
import type { BlurRegion } from "@/lib/video-edit"

const VIDEO_TOOLS: AnnotationTool[] = [
  "pen",
  "line",
  "arrow",
  "rect",
  "marker",
  "text",
  "blur",
]
// Smallest shape worth keeping, as a share of the frame width.
const MIN_SHAPE_FRACTION = 0.005

type FrameSize = { width: number; height: number }

function toBlurRegion(rect: PixelRect, frame: FrameSize): BlurRegion {
  return {
    id: crypto.randomUUID(),
    x: rect.x / frame.width,
    y: rect.y / frame.height,
    width: rect.width / frame.width,
    height: rect.height / frame.height,
  }
}

interface VideoEditorProps {
  sourceBlob: Blob
  durationMs: number
  trim: TrimRange | null
  initialOverlays: VideoOverlays
  onApply: (overlays: VideoOverlays) => void
  onCancel: () => void
}

// Drawings show for a few seconds and blur covers the whole clip; both are
// burned into the video on submit.
export function VideoEditor({
  sourceBlob,
  durationMs,
  trim,
  initialOverlays,
  onApply,
  onCancel,
}: VideoEditorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isPrimingRef = useRef(false)
  const [tool, setTool] = useState<AnnotationTool>("arrow")
  const [color, setColor] = useState(DEFAULT_ANNOTATION_COLOR)
  const overlays = useUndoable<VideoOverlays>(initialOverlays)
  const [frame, setFrame] = useState<FrameSize | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const range = trim ?? { startMs: 0, endMs: durationMs }
  const [currentMs, setCurrentMs] = useState(range.startMs)
  const { drawings, blurRegions } = overlays.value
  usePlaybackClock(videoRef, isPlaying, setCurrentMs)

  const sourceUrl = useMemo(() => URL.createObjectURL(sourceBlob), [sourceBlob])
  useEffect(() => () => URL.revokeObjectURL(sourceUrl), [sourceUrl])

  const seekTo = (ms: number) => {
    const video = videoRef.current
    if (!video) return
    const next = clamp(ms, range.startMs, range.endMs)
    video.currentTime = next / 1000
    setCurrentMs(next)
  }

  const handleLoadedMetadata = () => {
    const video = videoRef.current
    if (!video) return
    setFrame({ width: video.videoWidth, height: video.videoHeight })
    isPrimingRef.current = true
    primeVideoDuration(video, () => {
      isPrimingRef.current = false
      setIsReady(true)
      seekTo(range.startMs)
    })
  }

  const handleTimeUpdate = () => {
    const video = videoRef.current
    if (!video || isPrimingRef.current) return
    const ms = video.currentTime * 1000
    setCurrentMs(ms)
    if (!video.paused && ms >= range.endMs) video.pause()
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) {
      video.pause()
      return
    }
    if (currentMs >= range.endMs - 50) seekTo(range.startMs)
    video.play().catch(() => undefined)
  }

  const addAnnotation = (annotation: Annotation) => {
    if (!frame) return
    if (annotation.kind === "blur") {
      overlays.update((current) => ({
        ...current,
        blurRegions: [
          ...current.blurRegions,
          toBlurRegion(annotation.rect, frame),
        ],
      }))
      return
    }
    const timing = getDrawingTiming(currentMs, range)
    overlays.update((current) => ({
      ...current,
      drawings: [
        ...current.drawings,
        {
          id: crypto.randomUUID(),
          annotation,
          space: frame,
          ...timing,
        },
      ],
    }))
    // Moved earlier at the end of the clip: show the frame where it starts.
    if (timing.startMs !== Math.round(currentMs)) seekTo(timing.startMs)
  }

  const toFramePoint = (event: PointerEvent<HTMLElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect()
    const size = frame ?? { width: box.width, height: box.height }
    return [
      clamp((event.clientX - box.left) / box.width, 0, 1) * size.width,
      clamp((event.clientY - box.top) / box.height, 0, 1) * size.height,
    ]
  }

  const drawing = useAnnotationDrawing({
    tool,
    color,
    disabled: !(isReady && frame),
    minSize: (frame?.width ?? 0) * MIN_SHAPE_FRACTION,
    toPoint: toFramePoint,
    // Drawing happens on a still frame.
    onDrawStart: () => videoRef.current?.pause(),
    onCommit: addAnnotation,
  })

  const videoCssWidth = videoRef.current?.getBoundingClientRect().width ?? 0
  const textFontCssPx =
    frame && videoCssWidth > 0
      ? (fontSizeFor(frame.width) * videoCssWidth) / frame.width
      : 16
  const hasEdits = drawings.length > 0 || blurRegions.length > 0

  return (
    <div className="space-y-4">
      <AnnotationToolbar
        canRedo={overlays.canRedo}
        canUndo={overlays.canUndo}
        color={color}
        onColorChange={setColor}
        onRedo={overlays.redo}
        onToolChange={setTool}
        onUndo={overlays.undo}
        tool={tool}
        tools={VIDEO_TOOLS}
      />

      <div className="flex justify-center overflow-hidden rounded-2xl bg-zinc-950 p-3 ring-1 ring-border">
        <div className="relative inline-block">
          <video
            className="block max-h-[400px] max-w-full rounded-md"
            onLoadedMetadata={handleLoadedMetadata}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onTimeUpdate={handleTimeUpdate}
            preload="auto"
            ref={videoRef}
            src={sourceUrl}
          >
            <track kind="captions" />
          </video>
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-md">
            {blurRegions.map((region) => (
              <BlurRegionBox key={region.id} region={region} />
            ))}
          </div>
          <VideoDrawingsOverlay
            draft={drawing.draft}
            drawings={drawings}
            space={frame}
            timeMs={currentMs}
          />
          <div
            className="absolute inset-0 cursor-crosshair touch-none"
            {...drawing.handlers}
          >
            {drawing.pendingText ? (
              <AnnotationTextInput
                color={color}
                fontSize={textFontCssPx}
                onCancel={drawing.cancelText}
                onChange={drawing.setPendingTextValue}
                onCommit={drawing.commitText}
                pending={drawing.pendingText}
              />
            ) : null}
          </div>
        </div>
      </div>

      <VideoTimeline
        currentMs={currentMs}
        disabled={!isReady}
        drawings={drawings}
        durationMs={durationMs}
        isPlaying={isPlaying}
        onSeek={seekTo}
        onTogglePlay={togglePlay}
        range={range}
      />

      <VideoEditList
        blurRegions={blurRegions}
        clipStartMs={range.startMs}
        drawings={drawings}
        durationMs={durationMs}
        onRemoveBlur={(id) =>
          overlays.update((current) => ({
            ...current,
            blurRegions: current.blurRegions.filter((item) => item.id !== id),
          }))
        }
        onRemoveDrawing={(id) =>
          overlays.update((current) => ({
            ...current,
            drawings: current.drawings.filter((item) => item.id !== id),
          }))
        }
        onSeek={seekTo}
        onShowForChange={(id, endMs) =>
          overlays.update((current) => ({
            ...current,
            drawings: current.drawings.map((item) =>
              item.id === id ? { ...item, endMs } : item
            ),
          }))
        }
      />

      <EditorFooter
        applyLabel="Done"
        canClear={hasEdits}
        onApply={() => onApply(overlays.value)}
        onCancel={onCancel}
        onClear={() =>
          overlays.update(() => ({ drawings: [], blurRegions: [] }))
        }
      />
    </div>
  )
}
