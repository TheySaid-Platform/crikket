import { type PixelRect, pixelateRegion } from "@/lib/pixelate"

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export type Point = [number, number]

// Shared by the screenshot editor, the video editor and the bar's live drawing.
export type AnnotationTool =
  | "pen"
  | "line"
  | "arrow"
  | "rect"
  | "marker"
  | "text"
  | "blur"
  | "crop"

/** Coordinates are in the drawing's own pixels: the screenshot, video frame or page. */
export type Annotation =
  | { kind: "pen"; color: string; points: Point[] }
  | { kind: "marker"; color: string; points: Point[] }
  | { kind: "line"; color: string; from: Point; to: Point }
  | { kind: "arrow"; color: string; from: Point; to: Point }
  | { kind: "rect"; color: string; rect: PixelRect }
  | { kind: "text"; color: string; at: Point; text: string }
  | { kind: "blur"; rect: PixelRect }

export const ANNOTATION_COLORS = [
  "#ef4444",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#111827",
  "#ffffff",
]
export const DEFAULT_ANNOTATION_COLOR = "#ef4444"

// The marker is a wide, see-through stroke, like a highlighter pen.
const MARKER_ALPHA = 0.4
const MARKER_WIDTH_FACTOR = 4

export function rectFromPoints(from: Point, to: Point): PixelRect {
  return {
    x: Math.min(from[0], to[0]),
    y: Math.min(from[1], to[1]),
    width: Math.abs(to[0] - from[0]),
    height: Math.abs(to[1] - from[1]),
  }
}

/** Stroke width that looks the same on a small or a 4K image. */
export function strokeWidthFor(spaceWidth: number): number {
  return Math.max(3, Math.round(spaceWidth / 300))
}

export function fontSizeFor(spaceWidth: number): number {
  return strokeWidthFor(spaceWidth) * 7
}

/** Text and crop do not draw by dragging, so they return null. */
export function startAnnotation(
  tool: AnnotationTool,
  color: string,
  point: Point
): Annotation | null {
  switch (tool) {
    case "pen":
    case "marker":
      return { kind: tool, color, points: [point] }
    case "line":
    case "arrow":
      return { kind: tool, color, from: point, to: point }
    case "rect":
      return { kind: "rect", color, rect: rectFromPoints(point, point) }
    case "blur":
      return { kind: "blur", rect: rectFromPoints(point, point) }
    default:
      return null
  }
}

/** Grows a shape as the pointer moves away from where it went down. */
export function extendAnnotation(
  annotation: Annotation,
  start: Point,
  point: Point
): Annotation {
  switch (annotation.kind) {
    case "pen":
    case "marker":
      return { ...annotation, points: [...annotation.points, point] }
    case "line":
    case "arrow":
      return { ...annotation, to: point }
    case "rect":
    case "blur":
      return { ...annotation, rect: rectFromPoints(start, point) }
    default:
      return annotation
  }
}

/** A stray click draws nothing: shapes smaller than minSize are dropped. */
export function isAnnotationLargeEnough(
  annotation: Annotation,
  minSize: number
): boolean {
  switch (annotation.kind) {
    case "pen":
    case "marker":
      return annotation.points.length > 1
    case "line":
    case "arrow":
      return (
        Math.hypot(
          annotation.to[0] - annotation.from[0],
          annotation.to[1] - annotation.from[1]
        ) > minSize
      )
    case "rect":
    case "blur":
      return annotation.rect.width > minSize && annotation.rect.height > minSize
    default:
      return annotation.text.trim().length > 0
  }
}

function strokePath(ctx: Context2D, points: Point[]) {
  const [first, ...rest] = points
  if (!first) return
  ctx.beginPath()
  ctx.moveTo(first[0], first[1])
  for (const point of rest) {
    ctx.lineTo(point[0], point[1])
  }
  ctx.stroke()
}

function drawArrow(ctx: Context2D, from: Point, to: Point, width: number) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0])
  const headLength = width * 5

  strokePath(ctx, [from, to])
  ctx.beginPath()
  ctx.moveTo(to[0], to[1])
  ctx.lineTo(
    to[0] - headLength * Math.cos(angle - Math.PI / 7),
    to[1] - headLength * Math.sin(angle - Math.PI / 7)
  )
  ctx.lineTo(
    to[0] - headLength * Math.cos(angle + Math.PI / 7),
    to[1] - headLength * Math.sin(angle + Math.PI / 7)
  )
  ctx.closePath()
  ctx.fill()
}

function drawRect(ctx: Context2D, rect: PixelRect, width: number) {
  const radius = Math.max(
    0,
    Math.min(width * 1.5, rect.width / 2, rect.height / 2)
  )
  ctx.beginPath()
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius)
  ctx.stroke()
}

// Dark text gets a light outline and light text a dark one, so text stays
// readable on any background.
function isDarkColor(color: string): boolean {
  const hex = color.replace("#", "")
  if (hex.length !== 6) return false
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  return red * 0.299 + green * 0.587 + blue * 0.114 < 110
}

function drawText(
  ctx: Context2D,
  annotation: Extract<Annotation, { kind: "text" }>,
  spaceWidth: number
) {
  const size = fontSizeFor(spaceWidth)
  ctx.font = `600 ${size}px system-ui, sans-serif`
  ctx.textBaseline = "top"
  ctx.lineWidth = Math.max(2, size / 8)
  ctx.strokeStyle = isDarkColor(annotation.color)
    ? "rgba(255, 255, 255, 0.85)"
    : "rgba(0, 0, 0, 0.6)"
  ctx.strokeText(annotation.text, annotation.at[0], annotation.at[1])
  ctx.fillText(annotation.text, annotation.at[0], annotation.at[1])
}

/** spaceWidth, the width of the image it was drawn on, sets the stroke. */
export function drawAnnotation(
  ctx: Context2D,
  annotation: Annotation,
  spaceWidth: number
): void {
  if (annotation.kind === "blur") {
    pixelateRegion(ctx, annotation.rect)
    return
  }

  const width = strokeWidthFor(spaceWidth)
  ctx.save()
  ctx.strokeStyle = annotation.color
  ctx.fillStyle = annotation.color
  ctx.lineWidth = width
  ctx.lineCap = "round"
  ctx.lineJoin = "round"

  switch (annotation.kind) {
    case "pen":
      strokePath(ctx, annotation.points)
      break
    case "marker":
      ctx.globalAlpha *= MARKER_ALPHA
      ctx.lineWidth = width * MARKER_WIDTH_FACTOR
      strokePath(ctx, annotation.points)
      break
    case "line":
      strokePath(ctx, [annotation.from, annotation.to])
      break
    case "arrow":
      drawArrow(ctx, annotation.from, annotation.to, width)
      break
    case "rect":
      drawRect(ctx, annotation.rect, width)
      break
    default:
      drawText(ctx, annotation, spaceWidth)
  }

  ctx.restore()
}
