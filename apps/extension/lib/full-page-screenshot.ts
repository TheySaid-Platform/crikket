import { delay } from "@/lib/utils"

// Long screenshots. A page that scrolls inside a panel instead of the window
// gets that panel captured.

interface CaptureFrame {
  x: number
  y: number
  width: number
  height: number
}

interface PageLayout {
  scrollHeight: number
  // Where the user had scrolled to: the capture starts there.
  startOffset: number
  // The part of the window that scrolls, in CSS pixels.
  frame: CaptureFrame
  viewportWidth: number
}

// An inline style changed for the capture, and what to put back.
type Restyle = [
  element: HTMLElement,
  property: string,
  value: string,
  priority: string,
]

interface FullPageState {
  target: HTMLElement | null
  originalScroll: number
  isFrozen: boolean
  restyled: Restyle[]
}

type FullPageWindow = Window & { __crikketFullPage?: FullPageState }

// Chrome allows two captureVisibleTab calls per second.
const CAPTURE_SPACING_MS = 550
// Time for the page to repaint (and lazy content to appear) after a scroll.
const SETTLE_MS = 200
const MAX_SHOTS = 10
// Taller canvases fail to export in Chrome, so a taller capture is scaled down.
const MAX_IMAGE_PX = 16_000

// The functions below run inside the page through chrome.scripting, so they
// must not use anything from outside their own body.

function preparePageForCapture(): PageLayout {
  const scope = window as FullPageWindow
  const doc = document.scrollingElement ?? document.documentElement
  let target: HTMLElement | null = null

  if (doc.scrollHeight <= window.innerHeight + 4) {
    let biggestArea = 0
    for (const element of document.querySelectorAll("body *")) {
      if (
        !(element instanceof HTMLElement) ||
        element.scrollHeight <= element.clientHeight + 4 ||
        element.clientHeight < 150
      ) {
        continue
      }
      const { overflowY } = getComputedStyle(element)
      if (overflowY !== "auto" && overflowY !== "scroll") continue
      const rect = element.getBoundingClientRect()
      const area = rect.width * rect.height
      if (area > biggestArea) {
        biggestArea = area
        target = element
      }
    }
  }

  const startOffset = target ? target.scrollTop : window.scrollY
  scope.__crikketFullPage = {
    target,
    originalScroll: startOffset,
    isFrozen: false,
    restyled: [],
  }

  if (target) {
    const rect = target.getBoundingClientRect()
    return {
      scrollHeight: target.scrollHeight,
      startOffset,
      frame: {
        x: rect.left + target.clientLeft,
        y: rect.top + target.clientTop,
        width: target.clientWidth,
        height: target.clientHeight,
      },
      viewportWidth: window.innerWidth,
    }
  }
  return {
    scrollHeight: doc.scrollHeight,
    startOffset,
    // clientHeight leaves out a horizontal scrollbar, as clientWidth does.
    frame: { x: 0, y: 0, width: doc.clientWidth, height: doc.clientHeight },
    viewportWidth: window.innerWidth,
  }
}

function scrollPageTo(top: number): number {
  const state = (window as FullPageWindow).__crikketFullPage
  if (state?.target) {
    state.target.scrollTo({ top, behavior: "instant" })
    return state.target.scrollTop
  }
  window.scrollTo({ top, behavior: "instant" })
  return window.scrollY
}

// Fixed elements would repeat on every screen, so they are hidden after the
// first one; sticky ones (table headers, dividers) go back into the page.
function freezeFloatingElements(): void {
  const state = (window as FullPageWindow).__crikketFullPage
  if (!state || state.isFrozen) return
  state.isFrozen = true

  const restyle = (element: HTMLElement, property: string, value: string) => {
    state.restyled.push([
      element,
      property,
      element.style.getPropertyValue(property),
      element.style.getPropertyPriority(property),
    ])
    element.style.setProperty(property, value, "important")
  }

  const scope = state.target ?? document.body
  for (const element of scope.querySelectorAll("*")) {
    if (!(element instanceof HTMLElement)) continue
    const { position } = getComputedStyle(element)
    if (position === "fixed") {
      restyle(element, "visibility", "hidden")
    } else if (position === "sticky") {
      // As relative, its top/bottom offset would shift it from its place.
      restyle(element, "position", "relative")
      for (const side of ["top", "right", "bottom", "left"]) {
        restyle(element, side, "auto")
      }
    }
  }
}

function restorePage(): void {
  const scope = window as FullPageWindow
  const state = scope.__crikketFullPage
  if (!state) return
  for (const [element, property, value, priority] of state.restyled) {
    if (value) {
      element.style.setProperty(property, value, priority)
    } else {
      element.style.removeProperty(property)
    }
    // Leaves no empty style attribute on elements that had none.
    if (element.getAttribute("style") === "") {
      element.removeAttribute("style")
    }
  }
  if (state.target) {
    state.target.scrollTo({ top: state.originalScroll, behavior: "instant" })
  } else {
    window.scrollTo({ top: state.originalScroll, behavior: "instant" })
  }
  scope.__crikketFullPage = undefined
}

async function runInPage<T, Args extends unknown[]>(
  tabId: number,
  func: (...args: Args) => T,
  ...args: Args
): Promise<T> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    injectImmediately: true,
  })
  return injection?.result as T
}

interface Shot {
  offset: number
  image: ImageBitmap
}

interface CaptureTarget {
  tabId: number
  windowId: number
}

export interface FullPageProgress {
  // Screens captured so far, out of the screens the page needs.
  screensDone: number
  screensTotal: number
}

// How the capture ended: at the bottom of the page, at the 10-screen limit,
// where the user stopped it, or when they switched to another tab.
export type FullPageEnding = "page-end" | "too-long" | "stopped" | "tab-changed"

export interface FullPageCapture {
  image: Blob
  screens: number
  ending: FullPageEnding
  // Image pixels per CSS pixel of the page, to show it at its real size.
  scale: number
}

// Screens are taken at shotScale (device pixels per CSS pixel) and drawn at
// imageScale, which is smaller when the image would be too tall.
async function stitchShots(
  shots: Shot[],
  frame: CaptureFrame,
  scales: { shotScale: number; imageScale: number },
  origin: number,
  height: number
): Promise<Blob> {
  const { shotScale, imageScale } = scales
  const canvas = new OffscreenCanvas(
    Math.round(frame.width * imageScale),
    Math.round(height * imageScale)
  )
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not stitch the screenshot.")
  for (const shot of shots) {
    context.drawImage(
      shot.image,
      frame.x * shotScale,
      frame.y * shotScale,
      frame.width * shotScale,
      frame.height * shotScale,
      0,
      (shot.offset - origin) * imageScale,
      frame.width * imageScale,
      frame.height * imageScale
    )
  }
  return await canvas.convertToBlob({ type: "image/png" })
}

async function isTabInFront(target: CaptureTarget): Promise<boolean> {
  const tab = await chrome.tabs.get(target.tabId).catch(() => null)
  return tab?.active === true && tab.windowId === target.windowId
}

// captureVisibleTab takes whatever tab is in front, so this returns null
// once the user switched tabs.
async function captureScreen(
  target: CaptureTarget,
  lastCaptureAt: number
): Promise<ImageBitmap | null> {
  await delay(
    Math.max(SETTLE_MS, lastCaptureAt + CAPTURE_SPACING_MS - Date.now())
  )
  if (!(await isTabInFront(target))) {
    if (lastCaptureAt === 0) {
      throw new Error("Stay on the page until the long screenshot is done.")
    }
    return null
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(target.windowId, {
    format: "png",
  })
  return await createImageBitmap(await (await fetch(dataUrl)).blob())
}

// Why the capture ends before taking screen number `index`, if it does.
function getEndingBeforeScreen(
  index: number,
  top: number,
  pageHeight: number,
  shouldStop?: () => boolean
): FullPageEnding | null {
  if (index === 0) return null
  // The last screen already reached the bottom.
  if (top >= pageHeight) return "page-end"
  return shouldStop?.() ? "stopped" : null
}

export async function captureFullPage(
  input: CaptureTarget & {
    onProgress?: (progress: FullPageProgress) => void
    // Checked before each new screen: the user can stop once they have the
    // part of the page they need.
    shouldStop?: () => boolean
  }
): Promise<FullPageCapture> {
  const layout = await runInPage(input.tabId, preparePageForCapture)
  const shots: Shot[] = []

  try {
    const step = layout.frame.height
    const pageHeight = layout.scrollHeight
    let lastCaptureAt = 0
    let scale = 1
    // Where the first screen landed; the image starts there.
    let origin = layout.startOffset
    let ending: FullPageEnding = "too-long"

    for (let index = 0; index < MAX_SHOTS; index++) {
      const top = layout.startOffset + index * step
      const endingBefore = getEndingBeforeScreen(
        index,
        top,
        pageHeight,
        input.shouldStop
      )
      if (endingBefore) {
        ending = endingBefore
        break
      }
      if (index === 1) await runInPage(input.tabId, freezeFloatingElements)

      const offset = await runInPage(input.tabId, scrollPageTo, top)
      // The page could not scroll any further.
      if (index > 0 && offset === shots.at(-1)?.offset) {
        ending = "page-end"
        break
      }

      const image = await captureScreen(input, lastCaptureAt)
      if (!image) {
        ending = "tab-changed"
        break
      }
      lastCaptureAt = Date.now()

      if (index === 0) {
        origin = offset
        scale = image.width / layout.viewportWidth
      }
      shots.push({ offset, image })
      input.onProgress?.({
        screensDone: shots.length,
        screensTotal: Math.min(
          MAX_SHOTS,
          Math.max(shots.length, Math.ceil((pageHeight - origin) / step))
        ),
      })
      // Scroll positions are rounded to screen pixels.
      if (offset + step >= pageHeight - 1) {
        ending = "page-end"
        break
      }
    }

    const lastShot = shots.at(-1)
    const capturedHeight =
      Math.min(pageHeight, (lastShot?.offset ?? origin) + step) - origin
    const imageScale = Math.min(scale, MAX_IMAGE_PX / capturedHeight)

    return {
      image: await stitchShots(
        shots,
        layout.frame,
        { shotScale: scale, imageScale },
        origin,
        capturedHeight
      ),
      screens: shots.length,
      ending,
      scale: imageScale,
    }
  } finally {
    for (const shot of shots) {
      shot.image.close()
    }
    await runInPage(input.tabId, restorePage).catch(() => undefined)
  }
}

export async function captureVisibleArea(windowId: number): Promise<Blob> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
  })
  return await (await fetch(dataUrl)).blob()
}
