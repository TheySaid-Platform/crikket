import { describe, expect, it } from "bun:test"
import {
  type BackgroundRecordingState,
  getRecordedMs,
  isPickerUnavailableError,
  isUserCancelError,
  readReviewSessionId,
} from "./protocol"

const recording = (
  overrides: Partial<BackgroundRecordingState> = {}
): BackgroundRecordingState => ({
  source: "display",
  tabId: 1,
  debuggerSessionId: "session_1",
  startedAt: 1000,
  pausedAt: null,
  pausedMs: 0,
  micState: "on",
  ...overrides,
})

describe("getRecordedMs", () => {
  it("counts the time since the start", () => {
    expect(getRecordedMs(recording(), 6000)).toBe(5000)
  })

  it("leaves out finished pauses and the current one", () => {
    const state = recording({ pausedMs: 2000, pausedAt: 8000 })
    expect(getRecordedMs(state, 10_000)).toBe(5000)
  })
})

describe("isPickerUnavailableError", () => {
  it("falls back to the recorder tab only when Chrome would not show the picker", () => {
    expect(isPickerUnavailableError("NotSupportedError")).toBe(true)
    expect(isPickerUnavailableError("InvalidStateError")).toBe(true)
  })

  it("shows every other error", () => {
    expect(isPickerUnavailableError("NotAllowedError")).toBe(false)
    expect(isPickerUnavailableError("NotReadableError")).toBe(false)
    expect(isPickerUnavailableError(undefined)).toBe(false)
  })
})

describe("isUserCancelError", () => {
  it("is quiet when the user closed the screen picker", () => {
    expect(isUserCancelError("NotAllowedError", "Permission denied")).toBe(true)
  })

  it("reports a block by the operating system and other errors", () => {
    expect(
      isUserCancelError("NotAllowedError", "Permission denied by system")
    ).toBe(false)
    expect(isUserCancelError("NotReadableError", "Could not start")).toBe(false)
  })
})

describe("readReviewSessionId", () => {
  const recorder = "chrome-extension://abc/recorder.html"

  it("reads the capture of a review page", () => {
    expect(
      readReviewSessionId(
        `${recorder}?captureType=video&debuggerSessionId=s1&review=1`,
        recorder
      )
    ).toBe("s1")
  })

  it("ignores the recorder page when it is not a review, and other pages", () => {
    expect(
      readReviewSessionId(`${recorder}?debuggerSessionId=s1`, recorder)
    ).toBeNull()
    expect(
      readReviewSessionId("https://example.com/?review=1", recorder)
    ).toBeNull()
    expect(readReviewSessionId(undefined, recorder)).toBeNull()
  })
})
