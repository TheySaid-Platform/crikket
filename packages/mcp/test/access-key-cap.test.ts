import { describe, expect, it } from "bun:test"

import { isOverAccessKeyCap } from "../src/access-key-cap"

const at = (second: number) => new Date(Date.UTC(2026, 9, 12, 9, 0, second))

describe("isOverAccessKeyCap", () => {
  const keys = [
    { id: "k3", createdAt: at(3) },
    { id: "k1", createdAt: at(1) },
    { id: "k2", createdAt: at(2) },
  ]

  it("keeps keys inside the cap and rejects the newest beyond it", () => {
    expect(isOverAccessKeyCap({ cap: 2, keyId: "k1", keys })).toBe(false)
    expect(isOverAccessKeyCap({ cap: 2, keyId: "k2", keys })).toBe(false)
    expect(isOverAccessKeyCap({ cap: 2, keyId: "k3", keys })).toBe(true)
  })

  it("lets exactly one of two racing creates keep its key", () => {
    // Two keys created in the same millisecond at a cap of 2.
    const racing = [
      { id: "k1", createdAt: at(1) },
      { id: "b-new", createdAt: at(5) },
      { id: "a-new", createdAt: at(5) },
    ]
    const results = ["a-new", "b-new"].map((keyId) =>
      isOverAccessKeyCap({ cap: 2, keyId, keys: racing })
    )
    expect(results).toEqual([false, true])
  })

  it("does not reject a key that is not in the list", () => {
    expect(isOverAccessKeyCap({ cap: 0, keyId: "gone", keys })).toBe(false)
  })
})
