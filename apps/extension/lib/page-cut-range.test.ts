import { describe, expect, it } from "bun:test"
import { FULL_RANGE, moveEdge, toCrop, toKeptRange } from "./page-cut-range"

const size = { width: 400, height: 2000 }

describe("toKeptRange", () => {
  it("keeps everything without a crop", () => {
    expect(toKeptRange(null, size.height)).toEqual(FULL_RANGE)
  })

  it("reads the top and bottom of any crop, also a narrow one", () => {
    const crop = { x: 120, y: 500, width: 200, height: 1000 }
    expect(toKeptRange(crop, size.height)).toEqual({ top: 0.25, bottom: 0.75 })
  })
})

describe("toCrop", () => {
  it("makes a full-width crop when nothing was cropped", () => {
    expect(toCrop({ top: 0.1, bottom: 0.6 }, size, null)).toEqual({
      x: 0,
      y: 200,
      width: 400,
      height: 1000,
    })
  })

  it("keeps the left and right edges of a crop made with the Crop tool", () => {
    const crop = { x: 120, y: 500, width: 200, height: 1000 }
    expect(toCrop({ top: 0.1, bottom: 0.75 }, size, crop)).toEqual({
      x: 120,
      y: 200,
      width: 200,
      height: 1300,
    })
  })

  it("does not drop a narrow crop when the handles cover the whole page", () => {
    const crop = { x: 120, y: 500, width: 200, height: 1000 }
    expect(toCrop(FULL_RANGE, size, crop)).toEqual({
      x: 120,
      y: 0,
      width: 200,
      height: 2000,
    })
  })

  it("returns no crop for the whole page at full width", () => {
    const crop = { x: 0, y: 500, width: 400, height: 1000 }
    expect(toCrop({ top: 0.0005, bottom: 0.9995 }, size, crop)).toBeNull()
  })
})

describe("moveEdge", () => {
  it("keeps a small part between the two handles", () => {
    expect(moveEdge("top", 0.9, { top: 0, bottom: 0.5 }).top).toBeCloseTo(0.47)
    expect(moveEdge("bottom", 0, { top: 0.2, bottom: 1 }).bottom).toBeCloseTo(
      0.23
    )
  })
})
