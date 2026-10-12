import { describe, expect, it } from "bun:test"
import { getDrawingTiming } from "./drawing-timing"

describe("getDrawingTiming", () => {
  const range = { startMs: 2000, endMs: 20_000 }

  it("shows a drawing for three seconds from where it was made", () => {
    expect(getDrawingTiming(5000.4, range)).toEqual({
      startMs: 5000,
      endMs: 8000,
    })
  })

  it("ends a drawing with the kept part of the clip", () => {
    expect(getDrawingTiming(18_000, range)).toEqual({
      startMs: 18_000,
      endMs: 20_000,
    })
  })

  it("starts a drawing made at the very end a second earlier", () => {
    expect(getDrawingTiming(20_000, range)).toEqual({
      startMs: 19_000,
      endMs: 20_000,
    })
  })

  it("never starts before the kept part", () => {
    expect(getDrawingTiming(500, range).startMs).toBe(2000)
  })

  it("still lasts some time in a clip shorter than a second", () => {
    const timing = getDrawingTiming(800, { startMs: 0, endMs: 600 })
    expect(timing.startMs).toBe(0)
    expect(timing.endMs).toBeGreaterThan(timing.startMs)
  })
})
