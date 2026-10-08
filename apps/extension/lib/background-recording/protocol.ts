import type { MicState } from "@/hooks/use-screen-capture"
import type { VideoSource } from "@/lib/capture-context"

// The background worker owns the recording state; the popup and the floating
// bar read it from storage and send it commands.

export const BACKGROUND_RECORDING_STORAGE_KEY = "backgroundRecording"
// The long screenshot's progress, so a popup opened again can show it.
export const FULL_PAGE_CAPTURE_STORAGE_KEY = "fullPageCapture"
// The review that is open but not sent yet, so it can be opened again after
// its page reloads, and cleaned up when that page closes.
export const PENDING_REVIEW_STORAGE_KEY = "pendingReview"
// Why the last recording could not be saved, shown once in the popup.
export const RECORDING_ERROR_STORAGE_KEY = "recordingError"

export interface PendingReview {
  // The tab the review is in: over the page, or its own tab.
  tabId: number
  url: string
  debuggerSessionId: string
  isOverlay: boolean
}

export interface BackgroundRecordingState {
  source: VideoSource
  // The recorded tab, or for a full screen recording the tab it started from.
  tabId: number
  debuggerSessionId: string
  startedAt: number
  // When the current pause began, or null while recording.
  pausedAt: number | null
  // Total time spent in pauses that have ended.
  pausedMs: number
  micState: MicState
  // Set when the user closes "You're muted": no more reminders for this
  // recording, on any tab.
  mutedWarningDismissed?: boolean
}

export const BACKGROUND_RECORDING_MESSAGE = {
  start: "crikket:recording:start",
  stop: "crikket:recording:stop",
  pause: "crikket:recording:pause",
  resume: "crikket:recording:resume",
  // Sent by the offscreen recorder when the capture ends on its own: the
  // recorded tab was closed, or the user clicked Chrome's "Stop sharing".
  ended: "crikket:recording:ended",
  getTabId: "crikket:recording:get-tab-id",
  dismissMutedWarning: "crikket:recording:dismiss-muted-warning",
  // Asks a page whether its floating bar is already running.
  barPing: "crikket:recording-bar:ping",
  // A screenshot (visible area or long), reviewed over the page.
  screenshot: "crikket:screenshot:capture",
  // Stops a long screenshot and keeps what was captured so far.
  screenshotStop: "crikket:screenshot:stop",
  openReview: "crikket:review:open",
  closeReview: "crikket:review:close",
  // From the popup: brings back the review that is not sent yet.
  reopenReview: "crikket:review:reopen",
  // From the review: its report was sent or dropped.
  reviewDone: "crikket:review:done",
} as const

export const OFFSCREEN_MESSAGE_TARGET = "crikket-offscreen"

// Port the floating bar opens to the offscreen recorder to receive the
// microphone level ({ level: 0..1 }) about ten times a second.
export const MIC_LEVEL_PORT_NAME = "crikket-mic-level"

export type OffscreenRequest =
  | {
      type: "start"
      source: "tab"
      streamId: string
      debuggerSessionId: string
    }
  | { type: "start"; source: "display"; debuggerSessionId: string }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "toggle-mic" }
  // Instant replay's video: keep the last minutes of a tab or the screen.
  | { type: "replay-video-start"; source: "tab"; streamId: string }
  | { type: "replay-video-start"; source: "display" }
  | { type: "replay-video-stop" }
  // Cuts a clip of the last minutes and holds it, with its times...
  | { type: "replay-video-save" }
  // ...then stores it for the review of this debugger session.
  | { type: "replay-video-store"; debuggerSessionId: string }

export type OffscreenResponse =
  | {
      ok: true
      startedAt?: number
      micState?: MicState
      // When the action happened; for a saved replay clip, its last frame.
      at?: number
    }
  // errorName is the DOMException name, so callers can tell a cancelled
  // screen picker (NotAllowedError) from Chrome refusing to show it.
  | { ok: false; error: string; errorName?: string }

// Chrome would not open the screen picker from the background. Only then does
// the popup fall back to the recorder tab; any other error is shown.
export function isPickerUnavailableError(errorName: string | undefined) {
  return errorName === "NotSupportedError" || errorName === "InvalidStateError"
}

export const REVIEW_QUERY_PARAM = "review"
// A long screenshot's review: a wider overlay, to show it at its real size.
export const REVIEW_WIDE_QUERY_PARAM = "wide"

/** Recording time so far, leaving out paused time. */
export function getRecordedMs(
  state: BackgroundRecordingState,
  now: number
): number {
  const currentPauseMs = state.pausedAt === null ? 0 : now - state.pausedAt
  return Math.max(0, now - state.startedAt - state.pausedMs - currentPauseMs)
}
