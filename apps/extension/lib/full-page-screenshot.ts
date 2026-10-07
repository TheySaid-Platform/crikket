// Full-page screenshots, run by the background worker: scroll the page one
// screen at a time, take a picture of each screen and stitch them into one
// tall image. It starts at what the user is looking at and goes down, so a
// long chat or feed is not captured from its very beginning. Web apps such as
// ClickUp scroll inside a panel rather than the page, so in that case the
// biggest scrolling panel is captured instead.

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

interface FullPageState {
  target: HTMLElement | null
  originalScroll: number
  hidden: [HTMLElement, string, string][]
}

type FullPageWindow = Window & { __crikketFullPage?: FullPageState }

// Chrome allows two captureVisibleTab calls per second.
const CAPTURE_SPACING_MS = 550
// Time for the page to repaint (and lazy content to appear) after a scroll.
const SETTLE_MS = 200
const MAX_SHOTS = 10
// Taller canvases fail to export in Chrome, so a taller capture is scaled
// down to fit.
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
    hidden: [],
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
    frame: { x: 0, y: 0, width: doc.clientWidth, height: window.innerHeight },
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

// Fixed and sticky elements (headers, chat widgets) would repeat in every
// screen, so they are hidden after the first one.
function hideFloatingElements(): void {
  const state = (window as FullPageWindow).__crikketFullPage
  if (!state || state.hidden.length > 0) return
  const scope = state.target ?? document.body
  for (const element of scope.querySelectorAll("*")) {
    if (!(element instanceof HTMLElement)) continue
    const { position } = getComputedStyle(element)
    if (position !== "fixed" && position !== "sticky") continue
    state.hidden.push([
      element,
      element.style.getPropertyValue("visibility"),
      element.style.getPropertyPriority("visibility"),
    ])
    element.style.setProperty("visibility", "hidden", "important")
  }
}

function restorePage(): void {
  const scope = window as FullPageWindow
  const state = scope.__crikketFullPage
  if (!state) return
  for (const [element, value, priority] of state.hidden) {
    if (value) {
      element.style.setProperty("visibility", value, priority)
    } else {
      element.style.removeProperty("visibility")
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

const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

interface Shot {
  offset: number
  image: ImageBitmap
}

export interface FullPageProgress {
  // Screens captured so far, out of the screens the page needs.
  screensDone: number
  screensTotal: number
}

// How the capture ended: at the bottom of the page, at the size limit of a
// very long page, or where the user stopped it.
export type FullPageEnding = "page-end" | "too-long" | "stopped"

export interface FullPageCapture {
  image: Blob
  screens: number
  ending: FullPageEnding
  // Image pixels per CSS pixel of the page, to show it at its real size.
  scale: number
}

// One tall image from the screens taken, starting at the first one (origin)
// and only as tall as they reach, so a capture cut short has no blank strip.
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

// Waits for the page to settle after a scroll, and for Chrome's limit of two
// captures a second, then takes a picture of the visible tab.
async function captureScreen(
  windowId: number,
  lastCaptureAt: number
): Promise<ImageBitmap> {
  await delay(
    Math.max(SETTLE_MS, lastCaptureAt + CAPTURE_SPACING_MS - Date.now())
  )
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: "png",
  })
  return await createImageBitmap(await (await fetch(dataUrl)).blob())
}

function getEnding(stopped: boolean, reachedEnd: boolean): FullPageEnding {
  if (stopped) return "stopped"
  return reachedEnd ? "page-end" : "too-long"
}

export async function captureFullPage(input: {
  tabId: number
  windowId: number
  onProgress?: (progress: FullPageProgress) => void
  // Checked before each new screen: the user can stop once they have the
  // part of the page they need.
  shouldStop?: () => boolean
}): Promise<FullPageCapture> {
  const layout = await runInPage(input.tabId, preparePageForCapture)
  const shots: Shot[] = []

  try {
    let lastCaptureAt = 0
    let scale = 1
    const pageHeight = layout.scrollHeight
    let reachedEnd = false
    let stopped = false
    const step = layout.frame.height
    // Where the first screen landed; the image starts there.
    let origin = layout.startOffset

    for (let index = 0; index < MAX_SHOTS; index++) {
      const top = layout.startOffset + index * step
      // The last screen already reached the bottom.
      if (index > 0 && top >= pageHeight) {
        reachedEnd = true
        break
      }
      if (index > 0 && input.shouldStop?.()) {
        stopped = true
        break
      }
      if (index === 1) await runInPage(input.tabId, hideFloatingElements)

      const offset = await runInPage(input.tabId, scrollPageTo, top)
      // The page could not scroll any further.
      if (index > 0 && offset === shots.at(-1)?.offset) {
        reachedEnd = true
        break
      }

      const image = await captureScreen(input.windowId, lastCaptureAt)
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
        reachedEnd = true
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
      ending: getEnding(stopped, reachedEnd),
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
