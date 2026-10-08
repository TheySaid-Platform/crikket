import { describe, expect, it } from "bun:test"
import {
  type BackgroundRecordingState,
  getRecordedMs,
  isPickerUnavailableError,
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
