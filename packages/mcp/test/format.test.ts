import { describe, expect, it } from "bun:test"

import { readAccessKeyOrganizationId } from "../src/access-key-metadata"
import {
  compactJson,
  formatOffset,
  isFailedNetworkRequest,
  jsonResult,
  MAX_TOOL_RESULT_CHARS,
  truncateText,
} from "../src/format"
import { buildMcpSessionContext } from "../src/session"
import { keepEnds } from "../src/tools/get-bug-context"
import { makeUser } from "./fixtures"

describe("truncateText", () => {
  it("leaves short text alone and marks what it cut", () => {
    expect(truncateText("hello", 10)).toBe("hello")
    expect(truncateText("hello world", 5)).toBe("hello… [6 more characters]")
    expect(truncateText(null, 5)).toBe(null)
  })
})

describe("compactJson", () => {
  it("keeps small values as objects and shortens big ones to text", () => {
    expect(compactJson({ a: 1 }, 100)).toEqual({ a: 1 })
    expect(compactJson(null, 100)).toBe(null)
    const big = compactJson({ text: "x".repeat(500) }, 50)
    expect(typeof big).toBe("string")
    expect(String(big).startsWith('{"text":"xxx')).toBe(true)
  })
})

describe("formatOffset", () => {
  it("formats milliseconds as m:ss.t", () => {
    expect(formatOffset(0)).toBe("0:00.0")
    expect(formatOffset(65_340)).toBe("1:05.3")
    expect(formatOffset(null)).toBe(null)
    expect(formatOffset(Number.NaN)).toBe(null)
    expect(formatOffset(-5)).toBe("0:00.0")
  })
})

describe("isFailedNetworkRequest", () => {
  it("counts 4xx, 5xx, status 0 and network failures", () => {
    expect(isFailedNetworkRequest({ status: 200, failure: null })).toBe(false)
    expect(isFailedNetworkRequest({ status: 304, failure: null })).toBe(false)
    expect(isFailedNetworkRequest({ status: null, failure: null })).toBe(false)
    expect(isFailedNetworkRequest({ status: 404, failure: null })).toBe(true)
    expect(isFailedNetworkRequest({ status: 503, failure: null })).toBe(true)
    expect(isFailedNetworkRequest({ status: 0, failure: null })).toBe(true)
    expect(
      isFailedNetworkRequest({ status: null, failure: "net::ERR_FAILED" })
    ).toBe(true)
  })
})

describe("jsonResult", () => {
  it("never returns more than the hard cap", () => {
    const result = jsonResult({ text: "x".repeat(MAX_TOOL_RESULT_CHARS * 2) })
    const [content] = result.content
    expect(content?.type).toBe("text")
    if (content?.type === "text") {
      expect(content.text.length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 100)
    }
  })
})

describe("keepEnds", () => {
  it("keeps the first third and the last two thirds of a long list", () => {
    const items = Array.from({ length: 100 }, (_, index) => index)
    const kept = keepEnds(items, 9)
    expect(kept).toEqual([0, 1, 2, 94, 95, 96, 97, 98, 99])
    expect(keepEnds([1, 2, 3], 9)).toEqual([1, 2, 3])
  })
})

describe("readAccessKeyOrganizationId", () => {
  it("reads metadata stored once or twice as JSON text", () => {
    const once = JSON.stringify({ organizationId: "org_a" })
    expect(readAccessKeyOrganizationId(once)).toBe("org_a")
    expect(readAccessKeyOrganizationId(JSON.stringify(once))).toBe("org_a")
    expect(readAccessKeyOrganizationId({ organizationId: "org_b" })).toBe(
      "org_b"
    )
  })

  it("returns null for anything else", () => {
    for (const value of [
      null,
      undefined,
      "",
      "not json",
      "{}",
      JSON.stringify({ organizationId: 42 }),
      JSON.stringify({ organizationId: "" }),
      42,
    ]) {
      expect(readAccessKeyOrganizationId(value)).toBe(null)
    }
  })
})

describe("buildMcpSessionContext", () => {
  it("scopes the session to the key's organization", () => {
    const now = new Date("2026-10-12T12:00:00Z")
    const session = buildMcpSessionContext({
      now,
      userAgent: "claude-code",
      principal: {
        keyId: "key_1",
        keyExpiresAt: null,
        organizationId: "org_a",
        user: makeUser(),
      },
    })

    expect(session.user.id).toBe("user_1")
    expect(session.session.activeOrganizationId).toBe("org_a")
    expect(session.session.userId).toBe("user_1")
    expect(session.session.id).toBe("mcp_key_1")
    expect(session.session.token).toBe("")
    expect(session.session.userAgent).toBe("claude-code")
    expect(session.session.expiresAt.getTime()).toBeGreaterThan(now.getTime())
  })
})
