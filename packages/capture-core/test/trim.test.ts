import { describe, expect, it } from "bun:test"

import { trimDebuggerPayload } from "../src/debugger/trim"
import type { BugReportDebuggerPayload } from "../src/debugger/types"

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
})
