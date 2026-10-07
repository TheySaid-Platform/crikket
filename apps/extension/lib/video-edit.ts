import { trimDebuggerPayload } from "@crikket/capture-core/debugger/trim"
import type { BugReportDebuggerPayload } from "@crikket/capture-core/debugger/types"
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Output,
  type VideoSample,
  WebMOutputFormat,
} from "mediabunny"
import type { CaptureType } from "@/hooks/use-recorder-init"
import { type Annotation, drawAnnotation } from "@/lib/annotations"
import { pixelateRegion } from "@/lib/pixelate"

/** A blurred area, stored as fractions (0 to 1) of the video's width and height. */
export interface BlurRegion {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * A drawing (arrow, box, text...) shown on part of the video. It is stored in
 * the pixels of the frame it was drawn on (space); frames of another size are
 * scaled to fit.
 */
export interface VideoDrawing {
  id: string
  annotation: Annotation
  space: { width: number; height: number }
  // When it shows, in the recording's own time.
  startMs: number
  endMs: number
}

export interface VideoEdits {
  trimStartMs: number
  trimEndMs: number
  blurRegions: BlurRegion[]
  drawings: VideoDrawing[]
}

export function isVideoEditNoop(
  edits: VideoEdits,
  durationMs: number
): boolean {
  return (
    edits.trimStartMs <= 0 &&
    edits.trimEndMs >= durationMs &&
    edits.blurRegions.length === 0 &&
    edits.drawings.length === 0
  )
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Draws the drawings visible at timeMs onto a frame of width x height. */
export function drawVideoDrawings(
  ctx: Context2D,
  drawings: VideoDrawing[],
  timeMs: number,
  width: number,
  height: number
): void {
  for (const drawing of drawings) {
    if (timeMs < drawing.startMs || timeMs >= drawing.endMs) continue
    ctx.save()
    ctx.scale(width / drawing.space.width, height / drawing.space.height)
    drawAnnotation(ctx, drawing.annotation, drawing.space.width)
    ctx.restore()
  }
}

/**
 * Drops and re-times debugger events so they line up with the trimmed video.
 * Paused time is already left out when the payload is built.
 */
export function alignDebuggerPayload(
  payload: BugReportDebuggerPayload,
  edits: VideoEdits | null
): BugReportDebuggerPayload {
  if (!edits) return payload
  return trimDebuggerPayload(payload, {
    startMs: edits.trimStartMs,
    endMs: edits.trimEndMs,
  })
}

export function getSubmissionDurationMs(input: {
  captureType: CaptureType
  videoEdits: VideoEdits | null
  recordedDurationMs: number | null
  startTime: number | null
}): number {
  if (input.captureType !== "video") return 0
  const fallbackMs = input.startTime ? Date.now() - input.startTime : 0
  return Math.max(
    0,
    getEditedDurationMs(input.videoEdits, input.recordedDurationMs) ??
      fallbackMs
  )
}

/** Length of the clip that will be submitted, after any trim. */
function getEditedDurationMs(
  edits: VideoEdits | null,
  originalDurationMs: number | null
): number | null {
  return edits ? edits.trimEndMs - edits.trimStartMs : originalDurationMs
}

/**
 * Produces a new WebM with the trim, blur and drawings applied. Runs entirely
 * in the browser using WebCodecs, so nothing leaves the machine until submit.
 */
export async function renderEditedVideo(
  source: Blob,
  edits: VideoEdits,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const input = new Input({
    source: new BlobSource(source),
    formats: ALL_FORMATS,
  })
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new BufferTarget(),
  })

  let ctx: OffscreenCanvasRenderingContext2D | null = null
  const process =
    edits.blurRegions.length > 0 || edits.drawings.length > 0
      ? (sample: VideoSample) => {
          if (!ctx) {
            ctx = new OffscreenCanvas(
              sample.displayWidth,
              sample.displayHeight
            ).getContext("2d")
            if (!ctx) {
              throw new Error("Could not create a canvas to edit the video.")
            }
          }
          const { width, height } = ctx.canvas
          ctx.clearRect(0, 0, width, height)
          sample.draw(ctx, 0, 0, width, height)
          for (const region of edits.blurRegions) {
            pixelateRegion(ctx, {
              x: region.x * width,
              y: region.y * height,
              width: region.width * width,
              height: region.height * height,
            })
          }
          // Samples arrive timed from the start of the trimmed clip.
          const sourceMs = sample.timestamp * 1000 + edits.trimStartMs
          drawVideoDrawings(ctx, edits.drawings, sourceMs, width, height)
          return ctx.canvas
        }
      : undefined

  try {
    const conversion = await Conversion.init({
      input,
      output,
      trim: {
        start: edits.trimStartMs / 1000,
        end: edits.trimEndMs / 1000,
      },
      video: process ? { process } : undefined,
      showWarnings: false,
    })

    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks
        .map((track) => track.reason)
        .join(", ")
      throw new Error(`This recording could not be edited (${reasons}).`)
    }

    if (onProgress) {
      conversion.onProgress = (progress) => onProgress(progress)
    }
    await conversion.execute()

    const buffer = (output.target as BufferTarget).buffer
    if (!buffer) {
      throw new Error("Editing produced an empty video.")
    }
    return new Blob([buffer], { type: "video/webm" })
  } finally {
    input.dispose()
  }
}
