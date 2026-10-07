type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** Size of one mosaic block relative to the image, so small text stays unreadable. */
const BLOCK_SIZE_RATIO = 1 / 60
const MIN_BLOCK_SIZE_PX = 8

let scratchCanvas: OffscreenCanvas | null = null

/**
 * Hides a region by replacing it with large mosaic blocks. Pixelation is used
 * instead of a CSS-style blur because a blur can sometimes be partially
 * reversed, while averaged blocks cannot.
 */
export function pixelateRegion(ctx: Context2D, rect: PixelRect): void {
  const canvas = ctx.canvas
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const width = Math.min(canvas.width - x, Math.ceil(rect.width))
  const height = Math.min(canvas.height - y, Math.ceil(rect.height))
  if (width <= 0 || height <= 0) return

  const blockSize = Math.max(
    MIN_BLOCK_SIZE_PX,
    Math.round(Math.max(canvas.width, canvas.height) * BLOCK_SIZE_RATIO)
  )
  const smallWidth = Math.max(1, Math.ceil(width / blockSize))
  const smallHeight = Math.max(1, Math.ceil(height / blockSize))

  if (!scratchCanvas) {
    scratchCanvas = new OffscreenCanvas(smallWidth, smallHeight)
  }
  scratchCanvas.width = smallWidth
  scratchCanvas.height = smallHeight
  const scratch = scratchCanvas.getContext("2d")
  if (!scratch) return

  scratch.imageSmoothingEnabled = true
  scratch.drawImage(canvas, x, y, width, height, 0, 0, smallWidth, smallHeight)

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(
    scratchCanvas,
    0,
    0,
    smallWidth,
    smallHeight,
    x,
    y,
    width,
    height
  )
  ctx.restore()
}
