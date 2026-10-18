import { describe, expect, it } from "bun:test"

import { decideKeyRateLimit } from "../src/key-rate-limit-policy"

const WINDOW = { maxRequests: 3, windowMs: 60_000, windowStartMs: 1_000_000 }

describe("decideKeyRateLimit", () => {
  it("allows requests up to the limit", () => {
    for (const count of [1, 2, 3]) {
      expect(
        decideKeyRateLimit({ ...WINDOW, count, nowMs: 1_010_000 })
      ).toEqual({ allowed: true })
    }
  })

  it("blocks the next request until the window ends", () => {
    expect(
      decideKeyRateLimit({ ...WINDOW, count: 4, nowMs: 1_010_000 })
    ).toEqual({ allowed: false, retryAfterSeconds: 50 })
  })

  it("never asks to wait less than a second", () => {
    expect(
      decideKeyRateLimit({ ...WINDOW, count: 4, nowMs: 1_059_999 })
    ).toEqual({ allowed: false, retryAfterSeconds: 1 })
    expect(
      decideKeyRateLimit({ ...WINDOW, count: 4, nowMs: 1_070_000 })
    ).toEqual({ allowed: false, retryAfterSeconds: 1 })
  })
})
