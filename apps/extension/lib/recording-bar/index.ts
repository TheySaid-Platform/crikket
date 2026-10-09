import {
  BACKGROUND_RECORDING_MESSAGE,
  BACKGROUND_RECORDING_STORAGE_KEY,
  type BackgroundRecordingState,
  MIC_LEVEL_PORT_NAME,
} from "@/lib/background-recording/protocol"
import { TOGGLE_MIC_MESSAGE_TYPE } from "@/lib/capture-context"
import {
  closeReviewOverlay,
  openReviewOverlay,
  setReviewOverlayHidden,
} from "./review-overlay"
import { createRecordingUi, type RecordingUi } from "./ui"

const REPLACE_EVENT = "crikket:recording-bar:replace"
const MIC_LEVEL_RETRY_MS = 1000

// Fails only if the extension was reloaded under this page; nothing to do then.
const send = (type: string) => {
  chrome.runtime.sendMessage({ type }).catch(() => undefined)
}

/** Injected into a page that shows the floating bar or the review. */
export function startRecordingBar(): void {
  // A reloaded extension leaves its old copy running on the page, with no way
  // to reach the extension. Ask it to step aside, then listen for the next one.
  document.dispatchEvent(new CustomEvent(REPLACE_EVENT))
  let isActive = true
  let ui: RecordingUi | null = null
  document.addEventListener(
    REPLACE_EVENT,
    () => {
      isActive = false
      hideUi()
    },
    { once: true }
  )

  let ownTabId: number | null = null
  const getOwnTabId = async (): Promise<number | null> => {
    if (ownTabId !== null) return ownTabId
    try {
      const response = (await chrome.runtime.sendMessage({
        type: BACKGROUND_RECORDING_MESSAGE.getTabId,
      })) as { tabId?: unknown } | undefined
      // Remember only a real answer, so a failed lookup is retried.
      ownTabId = typeof response?.tabId === "number" ? response.tabId : null
    } catch {
      ownTabId = null
    }
    return ownTabId
  }

  // A full screen recording follows the user, so it shows the bar on every
  // tab; a tab recording only on the recorded tab.
  const shouldShowBar = async (state: BackgroundRecordingState | null) => {
    if (!state) return false
    if (state.source === "display") return true
    return state.tabId === (await getOwnTabId())
  }

  // Live microphone level for the bar's meter, from the offscreen recorder.
  let micLevelPort: chrome.runtime.Port | null = null
  let micLevelRetry: ReturnType<typeof setTimeout> | undefined
  const connectMicLevel = () => {
    try {
      const port = chrome.runtime.connect({ name: MIC_LEVEL_PORT_NAME })
      port.onMessage.addListener((message: { level?: unknown }) => {
        if (typeof message?.level === "number") {
          ui?.setMicLevel(message.level)
        }
      })
      // The recorder was not listening yet, or went away: try again while
      // the bar is up, or the meter would stay flat for the whole recording.
      port.onDisconnect.addListener(() => {
        if (micLevelPort !== port) return
        micLevelPort = null
        if (ui) {
          micLevelRetry = setTimeout(connectMicLevel, MIC_LEVEL_RETRY_MS)
        }
      })
      micLevelPort = port
    } catch {
      // The extension was reloaded under this page; the meter stays idle.
      micLevelPort = null
    }
  }
  const disconnectMicLevel = () => {
    clearTimeout(micLevelRetry)
    const port = micLevelPort
    micLevelPort = null
    port?.disconnect()
  }

  let latestRender = 0
  const render = async (state: BackgroundRecordingState | null) => {
    const renderId = ++latestRender
    const showBar = await shouldShowBar(state)
    // Replaced, or a newer state arrived while we were waiting.
    if (!isActive || renderId !== latestRender) return

    if (!(state && showBar)) {
      hideUi()
      return
    }

    if (!ui) {
      ui = createRecordingUi({
        stop: () => send(BACKGROUND_RECORDING_MESSAGE.stop),
        pause: () => send(BACKGROUND_RECORDING_MESSAGE.pause),
        resume: () => send(BACKGROUND_RECORDING_MESSAGE.resume),
        toggleMic: () => send(TOGGLE_MIC_MESSAGE_TYPE),
        dismissMutedWarning: () =>
          send(BACKGROUND_RECORDING_MESSAGE.dismissMutedWarning),
      })
      connectMicLevel()
    }
    ui.update(state)
  }

  const hideUi = () => {
    disconnectMicLevel()
    ui?.destroy()
    ui = null
  }

  chrome.storage.local
    .get(BACKGROUND_RECORDING_STORAGE_KEY)
    .then((result) =>
      render(
        (result[BACKGROUND_RECORDING_STORAGE_KEY] as
          | BackgroundRecordingState
          | undefined) ?? null
      )
    )
    .catch(() => undefined)

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isActive) return
    if (message?.type === BACKGROUND_RECORDING_MESSAGE.barPing) {
      sendResponse({ ok: true })
      return
    }
    // New state from the background worker.
    if (message?.type === BACKGROUND_RECORDING_MESSAGE.barState) {
      render((message.state as BackgroundRecordingState | null) ?? null)
      return
    }
    if (message?.type === BACKGROUND_RECORDING_MESSAGE.hideReview) {
      setReviewOverlayHidden(message.hidden === true)
      sendResponse({ ok: true })
      return
    }
    if (
      message?.type === BACKGROUND_RECORDING_MESSAGE.openReview &&
      typeof message.url === "string"
    ) {
      openReviewOverlay(message.url)
      sendResponse({ ok: true })
      return
    }
    if (message?.type === BACKGROUND_RECORDING_MESSAGE.closeReview) {
      closeReviewOverlay()
      sendResponse({ ok: true })
    }
  })
}
