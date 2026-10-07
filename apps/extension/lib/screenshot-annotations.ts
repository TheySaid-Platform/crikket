import {
  type Annotation,
  drawAnnotation,
  strokeWidthFor,
} from "@/lib/annotations"
import type { PixelRect } from "@/lib/pixelate"

export interface ScreenshotEdits {
  annotations: Annotation[]
  crop: PixelRect | null
}

export const EMPTY_SCREENSHOT_EDITS: ScreenshotEdits = {
  annotations: [],
  crop: null,
}

/**
 * Draws the screenshot with every annotation on top. In preview mode the crop
 * is shown as a dimmed frame; in export mode nothing extra is drawn.
 */
export function renderScreenshot(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  annotations: Annotation[],
  options: { crop?: PixelRect | null; preview?: boolean } = {}
) {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)

  for (const annotation of annotations) {
    drawAnnotation(ctx, annotation, width)
  }

  if (options.preview && options.crop) {
    const { x, y, width: w, height: h } = options.crop
    ctx.save()
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)"
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.rect(x, y, w, h)
    ctx.fill("evenodd")
    ctx.strokeStyle = "white"
    ctx.lineWidth = strokeWidthFor(width) / 2
    ctx.setLineDash([12, 8])
    ctx.strokeRect(x, y, w, h)
    ctx.restore()
  }
}

export function exportScreenshot(
  image: CanvasImageSource & { width: number; height: number },
  edits: ScreenshotEdits
): Promise<Blob> {
  const full = document.createElement("canvas")
  full.width = image.width
  full.height = image.height
  const fullCtx = full.getContext("2d")
  if (!fullCtx) throw new Error("Could not create a canvas for the screenshot.")
  renderScreenshot(fullCtx, image, edits.annotations)

  let output = full
  if (edits.crop) {
    const { x, y, width, height } = edits.crop
    output = document.createElement("canvas")
    output.width = Math.max(1, Math.round(width))
    output.height = Math.max(1, Math.round(height))
    output
      .getContext("2d")
      ?.drawImage(full, x, y, width, height, 0, 0, output.width, output.height)
  }

  return new Promise((resolve, reject) => {
    output.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("Could not save the edited screenshot."))
    }, "image/png")
  })
}
