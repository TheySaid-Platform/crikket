import { useEffect, useRef, useState } from "react"
import { type Annotation, drawAnnotation } from "@/lib/annotations"
import { drawVideoDrawings, type VideoDrawing } from "@/lib/video-edit"

interface VideoDrawingsOverlayProps {
  drawings: VideoDrawing[]
  timeMs: number
  // A shape being drawn right now, in the pixels of `space`.
  draft?: Annotation | null
  space?: { width: number; height: number } | null
}

/**
 * Shows the drawings that are visible at timeMs over the video, the same way
 * they will be drawn into the frames when the report is submitted.
 */
export function VideoDrawingsOverlay({
  drawings,
  timeMs,
  draft = null,
  space = null,
}: VideoDrawingsOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!(canvas && ctx)) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * ratio)
    canvas.height = Math.round(size.height * ratio)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawVideoDrawings(ctx, drawings, timeMs, canvas.width, canvas.height)

    if (!(draft && space)) return
    ctx.save()
    ctx.scale(canvas.width / space.width, canvas.height / space.height)
    if (draft.kind === "blur") {
      // The real blur needs the video pixels; show where it will go.
      const pixel = space.width / canvas.width
      ctx.strokeStyle = "white"
      ctx.lineWidth = 2 * pixel
      ctx.setLineDash([8 * pixel, 6 * pixel])
      const { x, y, width, height } = draft.rect
      ctx.strokeRect(x, y, width, height)
    } else {
      drawAnnotation(ctx, draft, space.width)
    }
    ctx.restore()
  }, [draft, drawings, size, space, timeMs])

  return (
    <canvas
      className="pointer-events-none absolute inset-0 h-full w-full"
      ref={canvasRef}
    />
  )
}
