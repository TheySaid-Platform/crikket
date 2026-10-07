import { useCallback, useMemo, useState } from "react"
import type { TrimRange } from "@/components/trimmable-video"
import type { CaptureType } from "@/hooks/use-recorder-init"
import type { ScreenshotEdits } from "@/lib/screenshot-annotations"
import {
  type BlurRegion,
  isVideoEditNoop,
  renderEditedVideo,
  type VideoDrawing,
  type VideoEdits,
} from "@/lib/video-edit"

export interface VideoOverlays {
  blurRegions: BlurRegion[]
  drawings: VideoDrawing[]
}

/**
 * Holds the edits to a capture. A screenshot is redrawn as soon as it is
 * edited. Video edits stay settings (trim, blur areas, drawings) while the
 * user reviews, like Jam, and are applied to the original recording once,
 * when the report is submitted.
 */
export function useCaptureEdits() {
  const [editedScreenshot, setEditedScreenshot] = useState<Blob | null>(null)
  const [videoEdits, setVideoEdits] = useState<VideoEdits | null>(null)
  const [screenshotEdits, setScreenshotEdits] =
    useState<ScreenshotEdits | null>(null)

  const setVideoTrim = useCallback((trim: TrimRange) => {
    setVideoEdits((current) => ({
      trimStartMs: trim.startMs,
      trimEndMs: trim.endMs,
      blurRegions: current?.blurRegions ?? [],
      drawings: current?.drawings ?? [],
    }))
  }, [])

  const setVideoOverlays = useCallback(
    (overlays: VideoOverlays, durationMs: number) => {
      setVideoEdits((current) => ({
        trimStartMs: current?.trimStartMs ?? 0,
        trimEndMs: current?.trimEndMs ?? durationMs,
        ...overlays,
      }))
    },
    []
  )

  const applyScreenshotEdits = useCallback(
    (result: { blob: Blob; edits: ScreenshotEdits } | null) => {
      setEditedScreenshot(result?.blob ?? null)
      setScreenshotEdits(result?.edits ?? null)
    },
    []
  )

  const videoTrim = useMemo<TrimRange | null>(
    () =>
      videoEdits
        ? { startMs: videoEdits.trimStartMs, endMs: videoEdits.trimEndMs }
        : null,
    [videoEdits]
  )
  const videoOverlays = useMemo<VideoOverlays>(
    () => ({
      blurRegions: videoEdits?.blurRegions ?? [],
      drawings: videoEdits?.drawings ?? [],
    }),
    [videoEdits]
  )

  const resetEdits = useCallback(() => {
    setEditedScreenshot(null)
    setVideoEdits(null)
    setScreenshotEdits(null)
  }, [])

  // The file to upload: the recording with its edits applied, or the
  // (possibly edited) screenshot.
  const prepareAttachment = useCallback(
    (captureType: CaptureType, capture: Blob, durationMs: number) => {
      if (
        captureType !== "video" ||
        !videoEdits ||
        isVideoEditNoop(videoEdits, durationMs)
      ) {
        return Promise.resolve(capture)
      }
      return renderEditedVideo(capture, videoEdits)
    },
    [videoEdits]
  )

  return {
    editedScreenshot,
    videoEdits,
    videoTrim,
    videoOverlays,
    screenshotEdits,
    setVideoTrim,
    setVideoOverlays,
    applyScreenshotEdits,
    resetEdits,
    prepareAttachment,
  }
}
