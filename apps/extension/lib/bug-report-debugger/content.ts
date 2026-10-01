import {
  CAPTURE_STATE_MESSAGE,
  PAGE_CONTROL_SOURCE,
  PAGE_EVENTS_EVENT,
} from "@crikket/capture-core/debugger/constants"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import {
  getDebuggerCaptureState,
  isDebuggerContentBridgePayload,
  sendDebuggerPageEvents,
} from "./messaging"

const CONTENT_BRIDGE_INSTALL_FLAG = "__crikketDebuggerContentBridgeInstalled"

export function setupDebuggerContentBridge(): void {
  if (typeof window === "undefined") {
    return
  }

  const scope = window as Window & {
    [CONTENT_BRIDGE_INSTALL_FLAG]?: boolean
  }

  if (scope[CONTENT_BRIDGE_INSTALL_FLAG]) {
    return
  }
  scope[CONTENT_BRIDGE_INSTALL_FLAG] = true

  const queue: unknown[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  // While the page unloads, timers no longer fire, so events go out at once.
  let isUnloading = false

  const BATCH_SIZE = 40
  const FLUSH_INTERVAL_MS = 120

  const flushQueue = () => {
    flushTimer = null

    if (queue.length === 0) {
      return
    }

    const events = queue.splice(0, BATCH_SIZE)
    sendDebuggerPageEvents(events).catch((error: unknown) => {
      reportNonFatalError("Failed to forward debugger page events", error)
    })

    if (queue.length > 0) {
      flushTimer = setTimeout(flushQueue, 0)
      return
    }
  }

  const scheduleFlush = () => {
    if (flushTimer) {
      return
    }

    flushTimer = setTimeout(flushQueue, FLUSH_INTERVAL_MS)
  }

  const flushAll = () => {
    while (queue.length > 0) {
      flushQueue()
    }
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  const enqueueEvents = (events: unknown[]) => {
    if (events.length === 0) {
      return
    }

    for (const candidate of events) {
      queue.push(candidate)
    }

    if (isUnloading) {
      flushAll()
      return
    }

    if (queue.length >= BATCH_SIZE) {
      if (flushTimer) {
        clearTimeout(flushTimer)
      }
      flushTimer = setTimeout(flushQueue, 0)
      return
    }

    scheduleFlush()
  }

  const onPageEvents = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail
    if (typeof detail !== "string") return

    let payload: unknown
    try {
      payload = JSON.parse(detail)
    } catch {
      return
    }
    if (!isDebuggerContentBridgePayload(payload)) return

    if (Array.isArray(payload.events)) {
      enqueueEvents(payload.events)
      return
    }

    enqueueEvents([payload.event])
  }

  window.addEventListener(PAGE_EVENTS_EVENT, onPageEvents)
  window.addEventListener(
    "pagehide",
    () => {
      isUnloading = true
      flushAll()
    },
    { capture: true }
  )
  // Back from the back/forward cache: normal batching again.
  window.addEventListener("pageshow", () => {
    isUnloading = false
  })

  // Response bodies are only read while this tab is recording. Ask once on
  // load (covers reloads and new iframes), then follow updates.
  const setNetworkBodies = (enabled: boolean) => {
    window.postMessage(
      { source: PAGE_CONTROL_SOURCE, networkBodies: enabled },
      window.location.origin === "null" ? "*" : window.location.origin
    )
  }

  getDebuggerCaptureState()
    .then((state) => {
      if (state?.networkBodies) {
        setNetworkBodies(true)
      }
    })
    .catch((error: unknown) => {
      reportNonFatalError("Failed to apply debugger capture state", error)
    })

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const candidate = message as { type?: unknown; networkBodies?: unknown }
    if (
      candidate?.type === CAPTURE_STATE_MESSAGE &&
      typeof candidate.networkBodies === "boolean"
    ) {
      setNetworkBodies(candidate.networkBodies)
    }
  })
}
