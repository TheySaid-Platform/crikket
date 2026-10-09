import { describe, expect, it } from "bun:test"
import type { DebuggerSessionSnapshot } from "@crikket/capture-core/debugger/types"
import { pickReportSnapshot } from "./report-snapshot"

const log = (timestamp: number) => ({
  kind: "console" as const,
  level: "log" as const,
  message: `log at ${timestamp}`,
  timestamp,
})

const snapshot = (
  timestamps: number[],
  recordingStoppedAt: number | null = 10_000
): DebuggerSessionSnapshot => ({
  sessionId: "session_1",
  captureTabId: 1,
  captureType: "video",
  startedAt: 0,
  recordingStartedAt: 0,
  recordingStoppedAt,
  tabs: [],
  events: timestamps.map(log),
})

describe("pickReportSnapshot", () => {
  it("uses whichever copy exists when the other is missing", () => {
    const live = snapshot([1000])
    expect(pickReportSnapshot(live, null)).toBe(live)
    expect(pickReportSnapshot(null, live)).toBe(live)
    expect(pickReportSnapshot(null, null)).toBeNull()
  })

  it("keeps the live copy when it has as many reported events", () => {
    const live = snapshot([1000, 2000])
    expect(pickReportSnapshot(live, snapshot([1000, 2000]))).toBe(live)
  })

  it("uses the saved copy when the live one lost reported events", () => {
    // More events in total, but the ones from the recording were pushed out
    // by events that came after Stop.
    const live = snapshot([2000, 11_000, 12_000, 13_000])
    const backup = snapshot([1000, 2000, 3000])

    const picked = pickReportSnapshot(live, backup)

    expect(picked?.events.map((event) => event.timestamp)).toEqual([
      1000, 2000, 3000,
    ])
    expect(picked?.recordingStoppedAt).toBe(10_000)
  })

  it("compares every event when the capture has no stop time", () => {
    const live = snapshot([1000, 2000, 3000], null)
    expect(pickReportSnapshot(live, snapshot([1000], null))).toBe(live)
  })
})
