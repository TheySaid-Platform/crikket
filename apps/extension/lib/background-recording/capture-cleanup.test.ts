import { describe, expect, it } from "bun:test"
import { planStartupCleanup } from "./capture-cleanup"
import type { PendingReview } from "./protocol"

const review = (sessionId: string, tabId: number): PendingReview => ({
  tabId,
  url: `chrome-extension://abc/recorder.html?debuggerSessionId=${sessionId}&review=1`,
  debuggerSessionId: sessionId,
  isOverlay: false,
})

describe("planStartupCleanup", () => {
  it("removes captures that no tab reviews and no session uses", () => {
    const plan = planStartupCleanup({
      storedIds: ["old", "live"],
      liveSessionIds: new Set(["live"]),
      reviewTabs: new Map(),
    })
    expect(plan).toEqual({ remove: ["old"], pending: null })
  })

  it("keeps a capture whose review tab Chrome restored, as the unsent review", () => {
    const restored = review("restored", 7)
    const plan = planStartupCleanup({
      storedIds: ["restored", "old"],
      liveSessionIds: new Set(),
      reviewTabs: new Map([["restored", restored]]),
    })
    expect(plan).toEqual({ remove: ["old"], pending: restored })
  })

  it("ignores review tabs whose capture is gone", () => {
    const plan = planStartupCleanup({
      storedIds: [],
      liveSessionIds: new Set(),
      reviewTabs: new Map([["gone", review("gone", 3)]]),
    })
    expect(plan).toEqual({ remove: [], pending: null })
  })
})
