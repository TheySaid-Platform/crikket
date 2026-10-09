import { Button } from "@crikket/ui/components/ui/button"
import {
  AlertTriangle,
  CheckCircle2,
  PenLine,
  Scissors,
  StopCircle,
} from "lucide-react"
import { TrimmableVideo, type TrimRange } from "@/components/trimmable-video"
import type { CaptureType } from "@/hooks/use-recorder-init"
import type { FullPageDetails } from "@/lib/recording-store"
import type { VideoEdits } from "@/lib/video-edit"

interface CapturePreviewProps {
  captureType: CaptureType
  previewUrl: string | null
  durationMs: number | null
  videoEdits: VideoEdits | null
  // Set for full-page screenshots.
  fullPage: FullPageDetails | null
  isScreenshotEdited: boolean
  disabled: boolean
  onTrimChange: (trim: TrimRange) => void
  // Opens the video or screenshot editor.
  onEdit: () => void
}

export function CapturePreview({
  captureType,
  previewUrl,
  durationMs,
  videoEdits,
  fullPage,
  isScreenshotEdited,
  disabled,
  onTrimChange,
  onEdit,
}: CapturePreviewProps) {
  if (!previewUrl) return null

  if (captureType === "video") {
    const blurRegions = videoEdits?.blurRegions ?? []
    const drawings = videoEdits?.drawings ?? []
    const editCount = blurRegions.length + drawings.length
    return (
      <div className="space-y-3">
        <TrimmableVideo
          blurRegions={blurRegions}
          disabled={disabled}
          drawings={drawings}
          durationMs={durationMs ?? 0}
          onTrimChange={onTrimChange}
          src={previewUrl}
          trim={
            videoEdits
              ? { startMs: videoEdits.trimStartMs, endMs: videoEdits.trimEndMs }
              : null
          }
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Drag the green handles to keep only the part that shows the bug.
          </p>
          <Button
            disabled={disabled}
            onClick={onEdit}
            size="sm"
            type="button"
            variant="outline"
          >
            <PenLine className="h-4 w-4" />
            {editCount > 0 ? `Draw & blur (${editCount})` : "Draw & blur"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {getScreenshotHint(isScreenshotEdited, fullPage !== null)}
        </p>
        <Button
          disabled={disabled}
          onClick={onEdit}
          size="sm"
          type="button"
          variant="outline"
        >
          {fullPage ? (
            <Scissors className="h-4 w-4" />
          ) : (
            <PenLine className="h-4 w-4" />
          )}
          {fullPage ? "Cut & edit" : "Edit screenshot"}
        </Button>
      </div>
      {fullPage ? (
        <>
          {/* Shown at full width and scrollable: shrunk to fit, a long page
              is a thin strip nobody can read. */}
          <div className="max-h-[min(70vh,720px)] overflow-y-auto rounded-xl border bg-black shadow-sm">
            {/* The density makes the browser show it at the page's size. */}
            <img
              alt="Long screenshot preview"
              className="mx-auto block h-auto max-w-full"
              src={previewUrl}
              srcSet={`${previewUrl} ${getPixelRatio(fullPage)}x`}
            />
          </div>
          {/* After a cut it would describe the page, not the image. */}
          {isScreenshotEdited ? null : <FullPageNote fullPage={fullPage} />}
        </>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-black shadow-sm">
          <img
            alt="Screenshot preview"
            className="max-h-[400px] w-full bg-black object-contain"
            src={previewUrl}
          />
        </div>
      )}
    </div>
  )
}

// Image pixels per CSS pixel of the page the screenshot was taken on.
function getPixelRatio(fullPage: FullPageDetails): number {
  return fullPage.scale ?? window.devicePixelRatio
}

function getScreenshotHint(isEdited: boolean, isFullPage: boolean): string {
  if (isEdited) return "Edits applied. You can edit again before submitting."
  if (isFullPage) {
    return "Cut it to the part that matters, or draw, blur and add text."
  }
  return "Draw, add text, blur or crop before submitting."
}

// Says how much of the page the full-page screenshot holds.
function FullPageNote({ fullPage }: { fullPage: FullPageDetails }) {
  const screens =
    fullPage.screens === 1 ? "1 screen" : `${fullPage.screens} screens`

  if (fullPage.ending === "page-end") {
    return (
      <p className="flex items-center gap-2 text-emerald-700 text-xs">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Captured down to the end of the page ({screens} tall). Scroll the
        preview to check it.
      </p>
    )
  }

  if (fullPage.ending === "tab-changed") {
    return (
      <p className="flex items-center gap-2 text-sky-700 text-xs">
        <StopCircle className="h-4 w-4 shrink-0" />
        You switched tabs, so the capture stopped after {screens}. Scroll the
        preview to check it.
      </p>
    )
  }

  if (fullPage.ending === "stopped") {
    return (
      <p className="flex items-center gap-2 text-sky-700 text-xs">
        <StopCircle className="h-4 w-4 shrink-0" />
        You stopped after {screens}. Scroll the preview to check it.
      </p>
    )
  }

  return (
    <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-amber-800 text-xs">
      <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
      This page is very long, so the capture stopped after {screens}. Scroll the
      preview to see where it ends.
    </p>
  )
}
