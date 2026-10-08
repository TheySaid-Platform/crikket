import { getElementTarget } from "./utils"

// Clicks on the extension's bar and review overlay are not repro steps.
// Events from inside their shadow roots arrive retargeted to these hosts.
const CRIKKET_UI_SELECTOR = "#crikket-recording-bar, #crikket-review-overlay"

const isCrikketUi = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(CRIKKET_UI_SELECTOR) !== null

interface ActionCaptureInput {
  postAction: (
    actionType: string,
    target: string | undefined,
    metadata?: Record<string, unknown>
  ) => void
}

export function installActionAndNavigationCapture(
  input: ActionCaptureInput
): void {
  const { postAction } = input

  const postNavigationBreadcrumb = (mode: string) => {
    postAction("navigation", "window", {
      mode,
      url: location.href,
      path: location.pathname,
      search: location.search,
      hash: location.hash,
      title: document.title,
    })
  }

  const delegatedHandlers: Record<
    "click" | "input" | "change",
    (event: Event) => void
  > = {
    click: (event) => {
      postAction("click", getElementTarget(event.target))
    },
    input: (event) => {
      const target = getElementTarget(event.target)
      let valueLength: number | undefined

      const inputTarget = event.target
      if (
        inputTarget instanceof HTMLInputElement ||
        inputTarget instanceof HTMLTextAreaElement
      ) {
        valueLength = inputTarget.value.length
      }

      postAction("input", target, {
        valueLength,
      })
    },
    change: (event) => {
      postAction("change", getElementTarget(event.target))
    },
  }

  const delegatedListener = (event: Event) => {
    if (
      (event.type !== "click" &&
        event.type !== "input" &&
        event.type !== "change") ||
      isCrikketUi(event.target)
    ) {
      return
    }

    delegatedHandlers[event.type](event)
  }

  for (const eventType of ["click", "input", "change"] as const) {
    document.addEventListener(eventType, delegatedListener, {
      capture: true,
      passive: true,
    })
  }

  const originalPushState = history.pushState
  history.pushState = function (...args) {
    originalPushState.apply(this, args)
    postNavigationBreadcrumb("pushState")
  }

  const originalReplaceState = history.replaceState
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args)
    postNavigationBreadcrumb("replaceState")
  }

  window.addEventListener(
    "popstate",
    () => {
      postNavigationBreadcrumb("popstate")
    },
    {
      capture: true,
      passive: true,
    }
  )

  window.addEventListener(
    "hashchange",
    () => {
      postNavigationBreadcrumb("hashchange")
    },
    {
      capture: true,
      passive: true,
    }
  )

  postNavigationBreadcrumb("initial")
}
