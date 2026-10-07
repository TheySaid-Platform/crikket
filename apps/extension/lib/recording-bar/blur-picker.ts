// Blurs parts of the page while recording, like Jam's blur tool: hover to see
// what will be blurred, click to blur it, click again to undo. Tab capture
// records the blurred pixels, so the private content never reaches the video.

const BLUR_FILTER = "blur(8px)"

export interface BlurPicker {
  setActive: (active: boolean) => void
  // Removes every blur, used when the recording ends.
  clearAll: () => void
  destroy: () => void
}

export function createBlurPicker(
  container: ShadowRoot,
  isOwnElement: (element: Element) => boolean
): BlurPicker {
  const highlight = document.createElement("div")
  highlight.style.cssText =
    "position:fixed;display:none;pointer-events:none;border:2px dashed #f43f5e;border-radius:4px;background:rgba(244,63,94,0.12);"
  container.append(highlight)

  // Element -> its own inline filter before we blurred it.
  const blurred = new Map<HTMLElement, string>()
  let active = false

  const pickTarget = (event: MouseEvent): HTMLElement | null => {
    const element = document.elementFromPoint(event.clientX, event.clientY)
    if (!(element instanceof HTMLElement) || isOwnElement(element)) {
      return null
    }
    if (element === document.documentElement || element === document.body) {
      return null
    }
    return element
  }

  const onMove = (event: MouseEvent) => {
    const target = pickTarget(event)
    if (!target) {
      highlight.style.display = "none"
      return
    }
    const rect = target.getBoundingClientRect()
    Object.assign(highlight.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
  }

  const toggleBlur = (element: HTMLElement) => {
    const original = blurred.get(element)
    if (original !== undefined) {
      element.style.filter = original
      blurred.delete(element)
      return
    }
    blurred.set(element, element.style.filter)
    element.style.filter = `${element.style.filter} ${BLUR_FILTER}`.trim()
  }

  // Swallow the page's own handling of clicks while picking. Listening on
  // window in the capture phase runs before anything on document, including
  // the repro step recorder, so picking does not show up as clicked steps.
  const onPointerEvent = (event: MouseEvent) => {
    const target = pickTarget(event)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    if (event.type === "click") {
      toggleBlur(target)
    }
  }

  const listeners: [string, (event: MouseEvent) => void][] = [
    ["mousemove", onMove],
    ["mousedown", onPointerEvent],
    ["mouseup", onPointerEvent],
    ["click", onPointerEvent],
  ]

  const setActive = (next: boolean) => {
    if (next === active) return
    active = next
    for (const [type, listener] of listeners) {
      if (active) {
        window.addEventListener(type, listener as EventListener, true)
      } else {
        window.removeEventListener(type, listener as EventListener, true)
      }
    }
    if (!active) highlight.style.display = "none"
  }

  const clearAll = () => {
    for (const [element, original] of blurred) {
      element.style.filter = original
    }
    blurred.clear()
  }

  return {
    setActive,
    clearAll,
    destroy: () => {
      setActive(false)
      highlight.remove()
    },
  }
}
