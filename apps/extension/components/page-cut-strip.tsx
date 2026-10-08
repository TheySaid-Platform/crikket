import { GripHorizontal } from "lucide-react"
import { type KeyboardEvent, type PointerEvent, useRef } from "react"
import type { PixelRect } from "@/lib/pixelate"

// The kept part of the page, as fractions (0 to 1) of its height.
interface KeptRange {
  top: number
  bottom: number
}

type Side = "top" | "bottom"

const MIN_KEPT_FRACTION = 0.03
const KEY_STEP = 0.01
const FULL_RANGE: KeptRange = { top: 0, bottom: 1 }

interface PageCutStripProps {
  imageUrl: string
  imageSize: { width: number; height: number }
  // The current crop; a full-width crop shows as the kept range.
  crop: PixelRect | null
  // While a handle moves: the crop it would make (null keeps everything).
  onPreview: (crop: PixelRect | null) => void
  onCommit: (crop: PixelRect | null) => void
  // Brings that point of the page (0 to 1) into view in the editor.
  onScrollTo: (fraction: number) => void
}

function toRange(crop: PixelRect | null, height: number): KeptRange {
  if (!crop || crop.x > 0.5 || height === 0) return FULL_RANGE
  return { top: crop.y / height, bottom: (crop.y + crop.height) / height }
}

function toCrop(
  range: KeptRange,
  size: { width: number; height: number }
): PixelRect | null {
  if (range.top <= 0.001 && range.bottom >= 0.999) return null
  return {
    x: 0,
    y: range.top * size.height,
    width: size.width,
    height: (range.bottom - range.top) * size.height,
  }
}

function moveEdge(side: Side, fraction: number, range: KeptRange): KeptRange {
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

/** A miniature of a long screenshot whose two handles pick what to keep. */
export function PageCutStrip({
  imageUrl,
  imageSize,
  crop,
  onPreview,
  onCommit,
  onScrollTo,
}: PageCutStripProps) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const range = toRange(crop, imageSize.height)

  const fractionAt = (clientY: number): number => {
    const box = stripRef.current?.getBoundingClientRect()
    if (!box || box.height === 0) return 0
    return Math.min(1, Math.max(0, (clientY - box.top) / box.height))
  }

  const startDrag =
    (side: Side) => (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      const handle = event.currentTarget
      handle.setPointerCapture(event.pointerId)
      let latest = range

      const onMove = (moveEvent: globalThis.PointerEvent) => {
        latest = moveEdge(side, fractionAt(moveEvent.clientY), latest)
        onPreview(toCrop(latest, imageSize))
        onScrollTo(side === "top" ? latest.top : latest.bottom)
      }
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove)
        handle.removeEventListener("pointerup", onUp)
        handle.removeEventListener("pointercancel", onUp)
        onCommit(toCrop(latest, imageSize))
      }
      handle.addEventListener("pointermove", onMove)
      handle.addEventListener("pointerup", onUp)
      handle.addEventListener("pointercancel", onUp)
    }

  const nudge = (side: Side) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = { ArrowUp: -KEY_STEP, ArrowDown: KEY_STEP }[event.key] ?? 0
    if (step === 0) return
    event.preventDefault()
    const next = moveEdge(side, range[side] + step, range)
    onScrollTo(next[side])
    onCommit(toCrop(next, imageSize))
  }

  return (
    <div className="flex h-full w-[92px] shrink-0 flex-col gap-2">
      <p className="text-center font-medium text-[11px] text-muted-foreground leading-tight">
        Keep this part
      </p>
      <div className="relative min-h-0 flex-1 py-2" ref={stripRef}>
        <div className="relative h-full overflow-hidden rounded-md bg-zinc-950 ring-1 ring-border">
          <img
            alt=""
            className="block h-full w-full object-fill"
            draggable={false}
            src={imageUrl}
          />
          <div
            className="absolute inset-x-0 top-0 bg-black/65"
            style={{ height: `${range.top * 100}%` }}
          />
          <div
            className="absolute inset-x-0 bottom-0 bg-black/65"
            style={{ height: `${(1 - range.bottom) * 100}%` }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 border-2 border-emerald-400"
            style={{
              top: `${range.top * 100}%`,
              bottom: `${(1 - range.bottom) * 100}%`,
            }}
          />
        </div>
        {(["top", "bottom"] as const).map((side) => (
          <button
            aria-label={
              side === "top" ? "Cut from the top" : "Cut from the bottom"
            }
            className="absolute inset-x-0 flex h-4 -translate-y-1/2 cursor-ns-resize touch-none items-center justify-center rounded-md bg-emerald-400 text-emerald-950 shadow-sm focus-visible:outline-2 focus-visible:outline-emerald-600"
            key={side}
            onKeyDown={nudge(side)}
            onPointerDown={startDrag(side)}
            style={{
              // The strip's inner area starts 8px down (py-2).
              top: `calc(8px + (100% - 16px) * ${range[side]})`,
            }}
            title="Drag to cut"
            type="button"
          >
            <GripHorizontal className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  )
}
