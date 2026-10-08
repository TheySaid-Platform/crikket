import { describe, expect, it } from "bun:test"

import { trimDebuggerPayload, trimDebuggerSnapshot } from "../src/debugger/trim"
import type {
  BugReportDebuggerPayload,
  DebuggerSessionSnapshot,
} from "../src/debugger/types"

const at = (offset: number | null) => ({
  timestamp: "2026-01-01T00:00:00.000Z",
  offset,
})

const payload: BugReportDebuggerPayload = {
  actions: [
    { type: "click", target: "button.early", ...at(2000) },
    { type: "click", target: "button.kept", ...at(12_000) },
  ],
  logs: [
    { level: "info", message: "before recording", ...at(null) },
    { level: "error", message: "inside", ...at(10_000) },
    { level: "warn", message: "late", ...at(30_000) },
  ],
  networkRequests: [
    { method: "GET", url: "https://example.com/a", ...at(25_000) },
    { method: "POST", url: "https://example.com/b", ...at(26_000) },
  ],
}

describe("trimDebuggerPayload", () => {
  it("drops events outside the range and shifts the rest to the new start", () => {
    const trimmed = trimDebuggerPayload(payload, {
      startMs: 10_000,
      endMs: 25_000,
    })

    expect(trimmed.actions.map((entry) => entry.offset)).toEqual([2000])
    expect(trimmed.logs.map((entry) => [entry.message, entry.offset])).toEqual([
      ["before recording", null],
      ["inside", 0],
    ])
    expect(trimmed.networkRequests.map((entry) => entry.offset)).toEqual([
      15_000,
    ])
  })

  it("keeps everything unchanged when the range covers the whole recording", () => {
    const trimmed = trimDebuggerPayload(payload, {
      startMs: 0,
      endMs: 60_000,
    })

    expect(trimmed).toEqual(payload)
  })

  it("does not mutate the input payload", () => {
    trimDebuggerPayload(payload, { startMs: 5000, endMs: 20_000 })

    expect(payload.actions[1]?.offset).toBe(12_000)
  })

  it("keeps a request that started before the cut and ended inside it", () => {
    const trimmed = trimDebuggerPayload(
      {
        actions: [],
        logs: [],
        networkRequests: [
          {
            method: "GET",
            url: "https://example.com/slow",
            duration: 3000,
            ...at(8000),
          },
          {
            method: "GET",
            url: "https://example.com/done",
            duration: 1000,
            ...at(4000),
          },
        ],
      },
      { startMs: 10_000, endMs: 25_000 }
    )

    expect(
      trimmed.networkRequests.map((entry) => [entry.url, entry.offset])
    ).toEqual([["https://example.com/slow", 0]])
  })
})

describe("trimDebuggerSnapshot", () => {
  const snapshot: DebuggerSessionSnapshot = {
    sessionId: "session_1",
    captureTabId: 1,
    captureType: "video",
    startedAt: 1000,
    recordingStartedAt: 1000,
    recordingStoppedAt: 61_000,
    tabs: [],
    events: [
      {
        kind: "console",
        level: "error",
        message: "Uncaught cut out",
        timestamp: 3000,
        tabId: 1,
      },
      {
        kind: "console",
        level: "error",
        message: "Uncaught kept",
        timestamp: 21_000,
        tabId: 1,
      },
      {
        kind: "network",
        method: "GET",
        url: "https://example.com/slow",
        duration: 4000,
        timestamp: 9000,
        tabId: 1,
      },
    ],
  }

  it("keeps only the events in the trimmed part, so a cut-out error cannot name the report", () => {
    const trimmed = trimDebuggerSnapshot(snapshot, {
      startMs: 10_000,
      endMs: 30_000,
    })

    expect(trimmed.events.map((event) => event.timestamp)).toEqual([
      21_000, 9000,
    ])
  })

  it("leaves paused time out when placing events", () => {
    const trimmed = trimDebuggerSnapshot(
      snapshot,
      { startMs: 0, endMs: 15_000 },
      [{ pausedAt: 5000, resumedAt: 11_000 }]
    )

    expect(trimmed.events.map((event) => event.timestamp)).toEqual([
      3000, 21_000, 9000,
    ])
  })
})
