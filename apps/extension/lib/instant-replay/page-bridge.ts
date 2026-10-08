import {
  INSTANT_REPLAY_ENABLED_STORAGE_KEY,
  INSTANT_REPLAY_MESSAGE,
  REPLAY_PAGE_EVENT,
} from "./protocol"

// A page can get this script twice (registered, and injected when instant
// replay is turned on), and a reloaded extension leaves its old copy behind.
// The newest copy asks the others to step aside.
const REPLACE_EVENT = "crikket:replay-bridge:replace"

// Asks the recorder for its events. Event listeners run during
// dispatchEvent, so the answer is there when it returns. Null when the
// recorder is not on this page.
function askRecorder(mode: "peek" | "take"): string | null {
  let answer: string | null = null
  const onResponse = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail
    answer = typeof detail === "string" ? detail : null
  }
  document.addEventListener(REPLAY_PAGE_EVENT.response, onResponse)
  document.dispatchEvent(
    new CustomEvent(REPLAY_PAGE_EVENT.request, { detail: mode })
  )
  document.removeEventListener(REPLAY_PAGE_EVENT.response, onResponse)
  return answer
}

/**
 * The recorder's link to the extension, in the extension's isolated world:
 * hands the replay to the background, and turns the recorder off with the
 * setting.
 */
export function startReplayBridge(): void {
  document.dispatchEvent(new CustomEvent(REPLACE_EVENT))
  const listeners = new AbortController()
  const { signal } = listeners

  const onMessage = (
    message: { type?: unknown },
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: { json: string | null }) => void
  ) => {
    if (message?.type !== INSTANT_REPLAY_MESSAGE.collect) return
    sendResponse({ json: askRecorder("peek") })
  }

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    const change = changes[INSTANT_REPLAY_ENABLED_STORAGE_KEY]
    if (areaName === "local" && change && change.newValue !== true) {
      document.dispatchEvent(new CustomEvent(REPLAY_PAGE_EVENT.stop))
    }
  }

  chrome.runtime.onMessage.addListener(onMessage)
  chrome.storage.onChanged.addListener(onStorageChanged)
  document.addEventListener(
    REPLACE_EVENT,
    () => {
      listeners.abort()
      try {
        chrome.runtime.onMessage.removeListener(onMessage)
        chrome.storage.onChanged.removeListener(onStorageChanged)
      } catch {
        // The extension was reloaded; these listeners are already gone.
      }
    },
    { once: true, signal }
  )

  // A reload or navigation ends this page and its recorder. The background
  // keeps what it recorded, so the replay goes on across pages.
  window.addEventListener(
    "pagehide",
    () => {
      const json = askRecorder("take")
      if (!json) return
      chrome.runtime
        .sendMessage({ type: INSTANT_REPLAY_MESSAGE.pageLeft, json })
        .catch(() => undefined)
    },
    { capture: true, signal }
  )
  window.addEventListener(
    "pageshow",
    (event) => {
      if (event.persisted) {
        document.dispatchEvent(new CustomEvent(REPLAY_PAGE_EVENT.snapshot))
      }
    },
    { signal }
  )
}
