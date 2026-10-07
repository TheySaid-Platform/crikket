import { type MouseEvent, type PointerEvent, useRef, useState } from "react"
import {
  type Annotation,
  type AnnotationTool,
  extendAnnotation,
  isAnnotationLargeEnough,
  type Point,
  rectFromPoints,
  startAnnotation,
} from "@/lib/annotations"
import type { PixelRect } from "@/lib/pixelate"

export interface PendingText {
  at: Point
  // Where the text box sits on the drawing surface, in CSS pixels.
  left: number
  top: number
  value: string
}

interface AnnotationDrawingOptions {
  tool: AnnotationTool
  color: string
  disabled?: boolean
  // Smallest shape worth keeping, in drawing coordinates.
  minSize: number
  // Converts a pointer position to drawing coordinates.
  toPoint: (event: PointerEvent<HTMLElement>) => Point
  onDrawStart?: () => void
  onCommit: (annotation: Annotation) => void
  onCrop?: (rect: PixelRect) => void
}

/**
 * Pointer handling shared by the screenshot and video editors: drag to draw a
 * shape, click to place text, drag to crop.
 */
export function useAnnotationDrawing({
  tool,
  color,
  disabled = false,
  minSize,
  toPoint,
  onDrawStart,
  onCommit,
  onCrop,
}: AnnotationDrawingOptions) {
  const [dragStart, setDragStart] = useState<Point | null>(null)
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [cropDraft, setCropDraft] = useState<PixelRect | null>(null)
  const [pendingText, setPendingText] = useState<PendingText | null>(null)
  // Mirrors pendingText so the text is committed once, even when Enter and
  // the input losing focus both try to commit it.
  const pendingTextRef = useRef<PendingText | null>(null)

  const updatePendingText = (next: PendingText | null) => {
    pendingTextRef.current = next
    setPendingText(next)
  }

  const commitText = () => {
    const pending = pendingTextRef.current
    updatePendingText(null)
    const text = pending?.value.trim()
    if (pending && text) {
      onCommit({ kind: "text", color, at: pending.at, text })
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (disabled) return
    // Clicking away from a text box finishes it.
    if (pendingTextRef.current) {
      commitText()
      return
    }

    const point = toPoint(event)
    onDrawStart?.()

    if (tool === "text") {
      const box = event.currentTarget.getBoundingClientRect()
      updatePendingText({
        at: point,
        left: event.clientX - box.left,
        top: event.clientY - box.top,
        value: "",
      })
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    setDragStart(point)
    if (tool === "crop") {
      setCropDraft(rectFromPoints(point, point))
    } else {
      setDraft(startAnnotation(tool, color, point))
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!dragStart) return
    const point = toPoint(event)
    if (tool === "crop") {
      setCropDraft(rectFromPoints(dragStart, point))
    } else {
      setDraft((current) =>
        current ? extendAnnotation(current, dragStart, point) : current
      )
    }
  }

  const onPointerUp = () => {
    if (!dragStart) return
    if (cropDraft) {
      if (cropDraft.width > minSize && cropDraft.height > minSize) {
        onCrop?.(cropDraft)
      }
    } else if (draft && isAnnotationLargeEnough(draft, minSize)) {
      onCommit(draft)
    }
    setDragStart(null)
    setDraft(null)
    setCropDraft(null)
  }

  return {
    draft,
    cropDraft,
    pendingText,
    setPendingTextValue: (value: string) => {
      const current = pendingTextRef.current
      if (current) updatePendingText({ ...current, value })
    },
    commitText,
    cancelText: () => updatePendingText(null),
    handlers: {
      // A click on the surface would otherwise move focus away from the text
      // box it just opened (and select page text while dragging).
      onMouseDown: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  }
}
