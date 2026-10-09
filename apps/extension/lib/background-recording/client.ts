import { reportNonFatalError } from "@crikket/shared/lib/errors"
import type { VideoSource } from "@/lib/capture-context"
import { BACKGROUND_RECORDING_MESSAGE } from "./protocol"

interface CommandResponse {
  ok?: boolean
  error?: string
  errorName?: string
}

/** The thrown error keeps the browser's error name. */
export async function requestBackgroundRecording(input: {
  source: VideoSource
  tabId: number
  debuggerSessionId: string
}): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: BACKGROUND_RECORDING_MESSAGE.start,
    ...input,
  })) as CommandResponse | undefined

  if (!response?.ok) {
    const error = new Error(response?.error ?? "Could not start recording.")
    if (response?.errorName) {
      error.name = response.errorName
    }
    throw error
  }
}

/** Takes a screenshot of the visible area or the whole page, then reviews it. */
export async function requestScreenshot(input: {
  mode: "visible" | "fullPage"
  tabId: number
  windowId: number
  debuggerSessionId: string
}): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: BACKGROUND_RECORDING_MESSAGE.screenshot,
    ...input,
  })) as CommandResponse | undefined

  if (!response?.ok) {
    throw new Error(response?.error ?? "Could not take the screenshot.")
  }
}

/** Ends a full-page screenshot early, keeping the part captured so far. */
export async function stopFullPageScreenshot(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: BACKGROUND_RECORDING_MESSAGE.screenshotStop,
    })
  } catch (error) {
    reportNonFatalError("Failed to stop the full-page screenshot", error)
  }
}

/** Pauses the background recording, or resumes it when it is paused. */
export async function toggleBackgroundRecordingPause(
  isPaused: boolean
): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: isPaused
        ? BACKGROUND_RECORDING_MESSAGE.resume
        : BACKGROUND_RECORDING_MESSAGE.pause,
    })
  } catch (error) {
    reportNonFatalError("Failed to pause or resume the recording", error)
  }
}

export async function stopBackgroundRecording(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: BACKGROUND_RECORDING_MESSAGE.stop,
    })
  } catch (error) {
    reportNonFatalError("Failed to stop the recording", error)
  }
}

// The review runs either in its own tab or in an overlay iframe on the
// recorded page; window.close() only works for the tab.
export function closeRecorderWindow(): void {
  if (window.top === window) {
    window.close()
    return
  }
  chrome.runtime
    .sendMessage({ type: BACKGROUND_RECORDING_MESSAGE.closeReview })
    .catch((error: unknown) => {
      reportNonFatalError("Failed to close the review overlay", error)
    })
}
