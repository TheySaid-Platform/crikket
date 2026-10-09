import { RECORDING_ERROR_STORAGE_KEY } from "@/lib/background-recording/protocol"

export type CaptureContext = { title?: string; url?: string }

// "tab" records one tab with tabCapture; "display" records the full screen, so
// the video follows the user across tabs.
export type VideoSource = "tab" | "display"
export const VIDEO_SOURCE_QUERY_PARAM = "videoSource"

export const readVideoSourceFromSearch = (search: string): VideoSource =>
  new URLSearchParams(search).get(VIDEO_SOURCE_QUERY_PARAM) === "display"
    ? "display"
    : "tab"

export const CAPTURE_CONTEXT_STORAGE_KEY = "captureContext"
export const CAPTURE_TAB_ID_STORAGE_KEY = "captureTabId"
export const RECORDING_IN_PROGRESS_STORAGE_KEY = "recordingInProgress"
export const RECORDER_TAB_ID_STORAGE_KEY = "recorderTabId"
export const RECORDING_COUNTDOWN_ENDS_AT_STORAGE_KEY =
  "recordingCountdownEndsAt"
// Moved forward by the paused time on each resume, so the elapsed recording
// time is always (pausedAt ?? now) - startedAt.
export const RECORDING_STARTED_AT_STORAGE_KEY = "recordingStartedAt"
// When the current pause began; null while recording.
export const RECORDING_PAUSED_AT_STORAGE_KEY = "recordingPausedAt"
export const TOGGLE_RECORDING_PAUSE_MESSAGE = "TOGGLE_RECORDING_PAUSE"
export const RECORDING_MIC_STATE_STORAGE_KEY = "recordingMicState"
export const TOGGLE_MIC_MESSAGE_TYPE = "TOGGLE_MIC_FROM_POPUP"
export const HOTKEY_START_VIDEO_CAPTURE_STORAGE_KEY = "hotkeyStartVideoCapture"
export const HOTKEY_START_SCREENSHOT_CAPTURE_STORAGE_KEY =
  "hotkeyStartScreenshotCapture"

const isExtensionUrl = (url?: string): boolean =>
  typeof url === "string" &&
  (url.startsWith("chrome-extension://") || url.startsWith("moz-extension://"))

export const sanitizeCaptureContext = (
  context?: CaptureContext
): CaptureContext => {
  if (!context) return {}
  if (isExtensionUrl(context.url)) return {}

  return {
    title: context.title ?? undefined,
    url: context.url ?? undefined,
  }
}

export const hasCaptureContext = (context: CaptureContext): boolean =>
  Boolean(context.title || context.url)

export const getActiveTabContext = async (): Promise<CaptureContext> => {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  })
  const activeTab = tabs[0]

  return sanitizeCaptureContext({
    title: activeTab?.title ?? undefined,
    url: activeTab?.url ?? undefined,
  })
}

export const readAndClearStoredCaptureContext =
  async (): Promise<CaptureContext> => {
    const stored = await chrome.storage.local.get([CAPTURE_CONTEXT_STORAGE_KEY])
    await chrome.storage.local.remove([CAPTURE_CONTEXT_STORAGE_KEY])

    return sanitizeCaptureContext(
      stored[CAPTURE_CONTEXT_STORAGE_KEY] as CaptureContext | undefined
    )
  }

export const readAndClearCaptureTabId = async (): Promise<number | null> => {
  const stored = await chrome.storage.local.get([CAPTURE_TAB_ID_STORAGE_KEY])
  await chrome.storage.local.remove([CAPTURE_TAB_ID_STORAGE_KEY])

  const tabId = stored[CAPTURE_TAB_ID_STORAGE_KEY]
  return typeof tabId === "number" ? tabId : null
}

// The toolbar badge shows on every tab, so the user can tell a full screen
// recording is paused from whichever tab they are on.
const RECORDING_BADGES = {
  recording: { text: "REC", color: "#dc2626" },
  paused: { text: "II", color: "#d97706" },
  // A capture failed; stays until the popup has shown why.
  error: { text: "!", color: "#dc2626" },
} as const

export const setRecordingBadge = async (
  status: "recording" | "paused" | null
): Promise<void> => {
  const stored = status
    ? {}
    : await chrome.storage.local.get(RECORDING_ERROR_STORAGE_KEY)
  const shown = status ?? (stored[RECORDING_ERROR_STORAGE_KEY] ? "error" : null)
  if (!shown) {
    await chrome.action.setBadgeText({ text: "" })
    return
  }

  const badge = RECORDING_BADGES[shown]
  await chrome.action.setBadgeBackgroundColor({ color: badge.color })
  await chrome.action.setBadgeText({ text: badge.text })
}
