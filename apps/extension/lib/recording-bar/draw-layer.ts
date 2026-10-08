// Shapes fade a moment after the pen lifts, so the page stays usable.

import {
  type Annotation,
  DEFAULT_ANNOTATION_COLOR,
  drawAnnotation,
  extendAnnotation,
  isAnnotationLargeEnough,
  type Point,
  startAnnotation,
} from "@/lib/annotations"

export type LiveDrawTool = "pen" | "line" | "arrow" | "rect" | "marker"

const HOLD_MS = 3500
const FADE_MS = 600
const MIN_SHAPE_PX = 4

interface Shape {
  annotation: Annotation
  start: Point
  endedAt: number | null
}

export interface DrawLayer {
  setActive: (active: boolean) => void
  setTool: (tool: LiveDrawTool) => void
  setColor: (color: string) => void
  undo: () => void
  clear: () => void
  destroy: () => void
}

export function createDrawLayer(container: ShadowRoot): DrawLayer {
  const canvas = document.createElement("canvas")
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;cursor:crosshair;touch-action:none;"
  container.prepend(canvas)

  const ctx = canvas.getContext("2d")
  const shapes: Shape[] = []
  let current: Shape | null = null
  let tool: LiveDrawTool = "pen"
  let color = DEFAULT_ANNOTATION_COLOR
  let frame = 0

  const resize = () => {
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(window.innerWidth * ratio)
    canvas.height = Math.round(window.innerHeight * ratio)
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0)
    scheduleRender()
  }

  const render = () => {
    frame = 0
    if (!ctx) return
    const now = performance.now()
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

    for (let index = shapes.length - 1; index >= 0; index--) {
      const shape = shapes[index]
      const fadeProgress =
        shape.endedAt === null
          ? 0
          : Math.max(0, now - shape.endedAt - HOLD_MS) / FADE_MS
      if (fadeProgress >= 1) {
        shapes.splice(index, 1)
      }
    }

    for (const shape of shapes) {
      const fadeProgress =
        shape.endedAt === null
          ? 0
          : Math.max(0, now - shape.endedAt - HOLD_MS) / FADE_MS
      ctx.globalAlpha = 1 - fadeProgress
      drawAnnotation(ctx, shape.annotation, window.innerWidth)
    }
    ctx.globalAlpha = 1

    if (shapes.length > 0) {
      frame = requestAnimationFrame(render)
    }
  }
  function scheduleRender() {
    if (!frame) frame = requestAnimationFrame(render)
  }

  resize()
  window.addEventListener("resize", resize)

  canvas.addEventListener("pointerdown", (event) => {
    const point: Point = [event.clientX, event.clientY]
    const annotation = startAnnotation(tool, color, point)
    if (!annotation) return
    canvas.setPointerCapture(event.pointerId)
    current = { annotation, start: point, endedAt: null }
    shapes.push(current)
    scheduleRender()
  })
  canvas.addEventListener("pointermove", (event) => {
    if (!current) return
    current.annotation = extendAnnotation(current.annotation, current.start, [
      event.clientX,
      event.clientY,
    ])
    scheduleRender()
  })
  const endShape = () => {
    if (!current) return
    if (isAnnotationLargeEnough(current.annotation, MIN_SHAPE_PX)) {
      current.endedAt = performance.now()
    } else {
      shapes.splice(shapes.indexOf(current), 1)
    }
    current = null
    scheduleRender()
  }
  canvas.addEventListener("pointerup", endShape)
  canvas.addEventListener("pointercancel", endShape)

  return {
    setActive: (active) => {
      canvas.style.pointerEvents = active ? "auto" : "none"
      if (!active) endShape()
    },
    setTool: (next) => {
      tool = next
    },
    setColor: (next) => {
      color = next
    },
    undo: () => {
      if (current) current = null
      shapes.pop()
      scheduleRender()
    },
    clear: () => {
      current = null
      shapes.length = 0
      scheduleRender()
    },
    destroy: () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", resize)
      canvas.remove()
    },
  }
}
