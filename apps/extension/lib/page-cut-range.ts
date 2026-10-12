import type { PixelRect } from "@/lib/pixelate"

// The kept part of the page, as fractions (0 to 1) of its height.
export interface KeptRange {
  top: number
  bottom: number
}

export type CutSide = "top" | "bottom"

interface Size {
  width: number
  height: number
}

const MIN_KEPT_FRACTION = 0.03
const EDGE_SNAP = 0.001
export const FULL_RANGE: KeptRange = { top: 0, bottom: 1 }

export function toKeptRange(crop: PixelRect | null, height: number): KeptRange {
  if (!crop || height === 0) return FULL_RANGE
  return { top: crop.y / height, bottom: (crop.y + crop.height) / height }
}

// Only the top and bottom move: a crop made with the Crop tool keeps its left
// and right edges, so what it cut away stays cut away.
export function toCrop(
  range: KeptRange,
  size: Size,
  current: PixelRect | null
): PixelRect | null {
  const top = range.top <= EDGE_SNAP ? 0 : range.top
  const bottom = range.bottom >= 1 - EDGE_SNAP ? 1 : range.bottom
  const x = current?.x ?? 0
  const width = current?.width ?? size.width
  const isFullWidth = x <= 0.5 && width >= size.width - 0.5
  if (top === 0 && bottom === 1 && isFullWidth) return null
  return {
    x,
    y: top * size.height,
    width,
    height: (bottom - top) * size.height,
  }
}

export function moveEdge(
  side: CutSide,
  fraction: number,
  range: KeptRange
): KeptRange {
  return side === "top"
    ? {
        top: Math.max(0, Math.min(fraction, range.bottom - MIN_KEPT_FRACTION)),
        bottom: range.bottom,
      }
    : {
        top: range.top,
        bottom: Math.min(1, Math.max(fraction, range.top + MIN_KEPT_FRACTION)),
      }
}
