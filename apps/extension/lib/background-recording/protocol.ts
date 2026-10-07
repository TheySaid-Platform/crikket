import type { MicState } from "@/hooks/use-screen-capture"
import type { VideoSource } from "@/lib/capture-context"

// Both "Record This Tab" and "Record Full Screen" record in an offscreen
// document, so no extension tab opens while recording (like Jam). The
// background worker owns the recording state; the popup and the floating bar
// on the page read it from storage and send it commands.

export const BACKGROUND_RECORDING_STORAGE_KEY = "backgroundRecording"
// While a full-page screenshot is being taken: its FullPageProgress, so the
// popup (even one opened again) can show it and offer to stop.
export const FULL_PAGE_CAPTURE_STORAGE_KEY = "fullPageCapture"

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
  // Takes a screenshot (of the visible area or the whole page) and opens its
  // review over the page.
  screenshot: "crikket:screenshot:capture",
  // Stops a full-page screenshot and keeps what was captured so far.
  screenshotStop: "crikket:screenshot:stop",
  openReview: "crikket:review:open",
  closeReview: "crikket:review:close",
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

export type OffscreenResponse =
  | { ok: true; startedAt?: number; micState?: MicState; at?: number }
  // errorName is the DOMException name, so callers can tell a cancelled
  // screen picker (NotAllowedError) from Chrome refusing to show it.
  | { ok: false; error: string; errorName?: string }

export const REVIEW_QUERY_PARAM = "review"
// Set on the review of a long screenshot: its overlay is wider, so the
// screenshot can show at the size it had on the page.
export const REVIEW_WIDE_QUERY_PARAM = "wide"

/** Recording time so far, leaving out paused time. */
export function getRecordedMs(
  state: BackgroundRecordingState,
  now: number
): number {
  const currentPauseMs = state.pausedAt === null ? 0 : now - state.pausedAt
  return Math.max(0, now - state.startedAt - state.pausedMs - currentPauseMs)
}
