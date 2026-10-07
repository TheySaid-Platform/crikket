import {
  BACKGROUND_LISTENER_FLAG,
  DISCARD_SESSION_MESSAGE,
  ENSURE_PAGE_RUNTIME_MESSAGE,
  GET_CAPTURE_STATE_MESSAGE,
  GET_SESSION_SNAPSHOT_MESSAGE,
  MARK_RECORDING_STARTED_MESSAGE,
  MARK_RECORDING_STOPPED_MESSAGE,
  PAGE_EVENT_MESSAGE,
  PAGE_EVENTS_MESSAGE,
  SET_RECORDING_PAUSED_MESSAGE,
  START_SESSION_MESSAGE,
} from "@crikket/capture-core/debugger/constants"
import type { DebuggerRuntimeResponse } from "@crikket/capture-core/debugger/types"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { isDebuggerRuntimeMessage } from "../../messaging"
import {
  createDebuggerSessionStore,
  type DebuggerSessionStore,
} from "./session-store"
import { registerWebRequestCollector } from "./web-request-collector"

let sessionStore: DebuggerSessionStore | null = null

/**
 * The session store, for other modules of the background worker (messages
 * sent from the worker never reach its own listeners).
 */
export function getDebuggerSessionStore(): DebuggerSessionStore | null {
  return sessionStore
}

export function registerDebuggerBackgroundListeners(): void {
  const scope = globalThis as typeof globalThis & {
    [BACKGROUND_LISTENER_FLAG]?: boolean
  }

  if (scope[BACKGROUND_LISTENER_FLAG]) {
    return
  }

  scope[BACKGROUND_LISTENER_FLAG] = true

  const store = createDebuggerSessionStore()
  sessionStore = store

  registerWebRequestCollector({
    onNetworkEvent: (tabId, event) => {
      store.appendPageEvents(tabId, [event]).catch((error: unknown) => {
        reportNonFatalError(
          `Failed to append webRequest event for tab ${tabId}`,
          error
        )
      })
    },
    reportError: reportNonFatalError,
  })

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isDebuggerRuntimeMessage(message)) {
      return
    }

    const safeSendResponse = <TData>(
      response: DebuggerRuntimeResponse<TData>
    ) => {
      sendResponse(response)
    }

    const onError = (error: unknown) => {
      safeSendResponse({
        ok: false,
        error:
          error instanceof Error ? error.message : "Debugger handler failed",
      })
    }

    const handler = async () => {
      const tabId = sender.tab?.id
      const appendEventsForSenderTab = async (events: unknown[]) => {
        if (typeof tabId !== "number") {
          return
        }

        await store.appendPageEvents(tabId, events, {
          // The top frame's own URL; iframes fall back to the tab's.
          pageUrl: sender.frameId === 0 ? sender.url : undefined,
          tabUrl: sender.tab?.url,
        })
      }

      switch (message.type) {
        case START_SESSION_MESSAGE: {
          const data = await store.startSession(message.payload)
          safeSendResponse({ ok: true, data })
          return
        }
        case MARK_RECORDING_STARTED_MESSAGE: {
          await store.markSessionRecordingStarted(message.payload)
          safeSendResponse({ ok: true, data: undefined })
          return
        }
        case MARK_RECORDING_STOPPED_MESSAGE: {
          await store.markSessionRecordingStopped(message.payload)
          safeSendResponse({ ok: true, data: undefined })
          return
        }
        case SET_RECORDING_PAUSED_MESSAGE: {
          await store.setSessionRecordingPaused(message.payload)
          safeSendResponse({ ok: true, data: undefined })
          return
        }
        case PAGE_EVENT_MESSAGE: {
          await appendEventsForSenderTab([message.payload.event])
          safeSendResponse({ ok: true, data: undefined })
          return
        }
        case PAGE_EVENTS_MESSAGE: {
          await appendEventsForSenderTab(message.payload.events)
          safeSendResponse({ ok: true, data: undefined })
          return
        }
        case ENSURE_PAGE_RUNTIME_MESSAGE: {
          if (typeof tabId === "number") {
            await store.injectDebuggerScriptForTab(tabId)
          }
          safeSendResponse({ ok: true, data: undefined })
          return
        }
        case GET_CAPTURE_STATE_MESSAGE: {
          const data =
            typeof tabId === "number"
              ? await store.getCaptureState(tabId)
              : { networkBodies: false }
          safeSendResponse({ ok: true, data })
          return
        }
        case GET_SESSION_SNAPSHOT_MESSAGE: {
          const data = await store.getSessionSnapshot(message.payload.sessionId)
          safeSendResponse({ ok: true, data })
          return
        }
        case DISCARD_SESSION_MESSAGE: {
          await store.discardSession(message.payload.sessionId)
          safeSendResponse({ ok: true, data: undefined })
          return
        }
        default: {
          safeSendResponse({ ok: true, data: undefined })
          return
        }
      }
    }

    handler().catch(onError)
    return true
  })

  const reportTabError = (context: string) => (error: unknown) => {
    reportNonFatalError(context, error)
  }

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const didTabNavigate =
      changeInfo.status === "loading" || typeof changeInfo.url === "string"

    if (didTabNavigate || typeof changeInfo.title === "string") {
      store
        .handleTabUpdated(tab)
        .catch(
          reportTabError(`Failed to track debugger tab update for tab ${tabId}`)
        )
    }

    // Also after load, so iframes that exist by then get the scripts too.
    if (!(didTabNavigate || changeInfo.status === "complete")) {
      return
    }

    const url =
      typeof changeInfo.url === "string"
        ? changeInfo.url
        : (tab.url ?? undefined)

    store
      .ensureDebuggerScriptForTab(tabId, url)
      .catch(
        reportTabError(
          `Failed to reinject debugger instrumentation after tab update for tab ${tabId}`
        )
      )
  })

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs
      .get(tabId)
      .then((tab) => store.handleTabActivated(tab))
      .catch(
        reportTabError(
          `Failed to track debugger tab activation for tab ${tabId}`
        )
      )
  })

  // Switching windows does not fire tabs.onActivated, so treat the focused
  // window's active tab as the tab the user switched to.
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      return
    }

    chrome.tabs
      .query({ active: true, windowId })
      .then(async ([tab]) => {
        if (tab) {
          await store.handleTabActivated(tab)
        }
      })
      .catch(
        reportTabError(
          `Failed to track debugger window focus for window ${windowId}`
        )
      )
  })

  chrome.tabs.onCreated.addListener((tab) => {
    store
      .handleTabCreated(tab)
      .catch(
        reportTabError(
          `Failed to track debugger tab creation for tab ${tab.id}`
        )
      )
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    store
      .handleTabRemoved(tabId)
      .catch(
        reportTabError(
          `Failed to clean up debugger state for removed tab ${tabId}`
        )
      )
  })
}
