import { ScreenshotEditor } from "@/components/screenshot-editor"
import type { TrimRange } from "@/components/trimmable-video"
import { VideoEditor } from "@/components/video-editor"
import type { VideoOverlays } from "@/hooks/use-capture-edits"
import type { CaptureType } from "@/hooks/use-recorder-init"
import type { ScreenshotEdits } from "@/lib/screenshot-annotations"

interface EditStepProps {
  captureType: CaptureType
  originalBlob: Blob | null
  durationMs: number
  trim: TrimRange | null
  videoOverlays: VideoOverlays
  screenshotEdits: ScreenshotEdits | null
  isLongScreenshot?: boolean
  // Image pixels per CSS pixel of a long screenshot.
  screenshotPixelRatio?: number
  onVideoOverlaysApplied: (overlays: VideoOverlays) => void
  onScreenshotEditsApplied: (
    result: { blob: Blob; edits: ScreenshotEdits } | null
  ) => void
  onCancel: () => void
}

export function EditStep({
  captureType,
  originalBlob,
  durationMs,
  trim,
  videoOverlays,
  screenshotEdits,
  isLongScreenshot,
  screenshotPixelRatio,
  onVideoOverlaysApplied,
  onScreenshotEditsApplied,
  onCancel,
}: EditStepProps) {
  if (!originalBlob) return null

  if (captureType === "video") {
    return (
      <VideoEditor
        durationMs={durationMs}
        initialOverlays={videoOverlays}
        onApply={onVideoOverlaysApplied}
        onCancel={onCancel}
        sourceBlob={originalBlob}
        trim={trim}
      />
    )
  }

  return (
    <ScreenshotEditor
      initialEdits={screenshotEdits}
      isLongScreenshot={isLongScreenshot}
      onApply={onScreenshotEditsApplied}
      onCancel={onCancel}
      pixelRatio={screenshotPixelRatio}
      sourceBlob={originalBlob}
    />
  )
}
