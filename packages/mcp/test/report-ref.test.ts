import { describe, expect, it } from "bun:test"

import { buildShareUrl, parseReportRef } from "../src/report-ref"

describe("parseReportRef", () => {
  it("accepts a bare report id", () => {
    expect(parseReportRef("gVQoTvqv0vRo")).toEqual({
      ok: true,
      id: "gVQoTvqv0vRo",
    })
    expect(parseReportRef("  abc_DEF-123  ")).toEqual({
      ok: true,
      id: "abc_DEF-123",
    })
  })

  it("accepts share links with or without a scheme", () => {
    for (const value of [
      "https://app.crikket.io/s/gVQoTvqv0vRo",
      "http://localhost:3001/s/gVQoTvqv0vRo",
      "https://crikket.dev.theysaid.io/s/gVQoTvqv0vRo/",
      "https://app.crikket.io/s/gVQoTvqv0vRo?tab=network#logs",
      "app.crikket.io/s/gVQoTvqv0vRo",
    ]) {
      expect(parseReportRef(value)).toEqual({ ok: true, id: "gVQoTvqv0vRo" })
    }
  })

  it("rejects anything that is not an id or a share link", () => {
    for (const value of [
      "",
      "https://app.crikket.io/reports/gVQoTvqv0vRo",
      "https://app.crikket.io/s/",
      "https://app.crikket.io/s/a/b",
      "javascript:alert(1)",
      "ftp://app.crikket.io/s/gVQoTvqv0vRo",
      "not an id",
      "a".repeat(65),
    ]) {
      const result = parseReportRef(value)
      expect(result.ok).toBe(false)
    }
  })

  it("keeps the error message short for huge input", () => {
    const result = parseReportRef(`https://x.io/${"y".repeat(5000)}`)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message.length).toBeLessThan(300)
    }
  })
})

describe("buildShareUrl", () => {
  it("joins the app origin and id without a double slash", () => {
    expect(buildShareUrl("https://app.crikket.io/", "abc")).toBe(
      "https://app.crikket.io/s/abc"
    )
    expect(buildShareUrl("https://app.crikket.io", "abc")).toBe(
      "https://app.crikket.io/s/abc"
    )
  })
})
