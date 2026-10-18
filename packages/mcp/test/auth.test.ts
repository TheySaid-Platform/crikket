import { describe, expect, it } from "bun:test"

import {
  type AccessKeyVerification,
  createMcpAuthenticator,
  extractBearerToken,
  type McpAuthDependencies,
} from "../src/auth"
import { makeUser } from "./fixtures"

const VALID_KEY = "crk_mcp_abcdefghijklmnopqrstuvwxyz"
const NOW = new Date("2026-10-12T12:00:00Z")

function request(authorization?: string): Request {
  const headers = new Headers()
  if (authorization !== undefined) {
    headers.set("authorization", authorization)
  }
  return new Request("http://localhost/api/mcp", { method: "POST", headers })
}

function setup(overrides: Partial<McpAuthDependencies> = {}) {
  const verified: string[] = []
  const deps: McpAuthDependencies = {
    verifyAccessKey: (key): Promise<AccessKeyVerification> => {
      verified.push(key)
      return Promise.resolve({
        valid: true,
        key: {
          id: "key_1",
          userId: "user_1",
          organizationId: "org_a",
          expiresAt: new Date("2027-01-01T00:00:00Z"),
        },
      })
    },
    limitKey: () => Promise.resolve({ allowed: true }),
    findUser: async () => makeUser(),
    isMember: async () => true,
    now: () => NOW,
    ...overrides,
  }

  return { authenticate: createMcpAuthenticator(deps), verified }
}

describe("extractBearerToken", () => {
  it("reads the token whatever the scheme case", () => {
    const headers = new Headers({ authorization: "bearer   tok_1  " })
    expect(extractBearerToken(headers)).toBe("tok_1")
  })

  it("ignores other schemes and empty values", () => {
    expect(
      extractBearerToken(new Headers({ authorization: "Basic abc" }))
    ).toBe(null)
    expect(extractBearerToken(new Headers({ authorization: "Bearer " }))).toBe(
      null
    )
    expect(extractBearerToken(new Headers())).toBe(null)
  })
})

describe("createMcpAuthenticator", () => {
  it("resolves the user and the key's organization", async () => {
    const { authenticate } = setup()
    const result = await authenticate(request(`Bearer ${VALID_KEY}`))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.principal.organizationId).toBe("org_a")
      expect(result.principal.user.id).toBe("user_1")
      expect(result.principal.keyId).toBe("key_1")
    }
  })

  it("asks for a key when none is sent", async () => {
    const { authenticate, verified } = setup()
    const result = await authenticate(request())

    expect(result).toMatchObject({
      ok: false,
      failure: { status: 401, code: "missing_token" },
    })
    expect(verified).toEqual([])
  })

  it("rejects a key without the MCP prefix before touching the database", async () => {
    const { authenticate, verified } = setup()
    const result = await authenticate(request("Bearer sk_live_something"))

    expect(result).toMatchObject({
      ok: false,
      failure: { status: 401, code: "invalid_token" },
    })
    expect(verified).toEqual([])
  })

  it("rejects an invalid, expired or revoked key", async () => {
    const { authenticate } = setup({
      verifyAccessKey: async () => ({ valid: false }),
    })

    expect(await authenticate(request(`Bearer ${VALID_KEY}`))).toMatchObject({
      ok: false,
      failure: { status: 401, code: "invalid_token" },
    })
  })

  it("answers 429 with a retry time when the key is over its limit", async () => {
    const limited: string[] = []
    const looked: string[] = []
    const { authenticate } = setup({
      limitKey: (keyId) => {
        limited.push(keyId)
        return Promise.resolve({ allowed: false, retryAfterSeconds: 7 })
      },
      findUser: (userId) => {
        looked.push(userId)
        return Promise.resolve(makeUser())
      },
    })

    expect(await authenticate(request(`Bearer ${VALID_KEY}`))).toMatchObject({
      ok: false,
      failure: { status: 429, code: "rate_limited", retryAfterSeconds: 7 },
    })
    expect(limited).toEqual(["key_1"])
    // A limited request stops before any user or membership lookup.
    expect(looked).toEqual([])
  })

  it("does not count requests from invalid keys", async () => {
    const limited: string[] = []
    const { authenticate } = setup({
      verifyAccessKey: () => Promise.resolve({ valid: false }),
      limitKey: (keyId) => {
        limited.push(keyId)
        return Promise.resolve({ allowed: true })
      },
    })

    await authenticate(request(`Bearer ${VALID_KEY}`))
    expect(limited).toEqual([])
  })

  it("rejects a key that is not bound to an organization", async () => {
    const { authenticate } = setup({
      verifyAccessKey: async () => ({
        valid: true,
        key: {
          id: "k",
          userId: "user_1",
          organizationId: null,
          expiresAt: null,
        },
      }),
    })

    expect(await authenticate(request(`Bearer ${VALID_KEY}`))).toMatchObject({
      ok: false,
      failure: { status: 401 },
    })
  })

  it("rejects a key whose user no longer exists", async () => {
    const { authenticate } = setup({ findUser: async () => null })

    expect(await authenticate(request(`Bearer ${VALID_KEY}`))).toMatchObject({
      ok: false,
      failure: { status: 401, code: "invalid_token" },
    })
  })

  it("blocks a banned user, and lets them back once the ban ends", async () => {
    const banned = setup({
      findUser: async () => makeUser({ banned: true, banExpires: null }),
    })
    expect(
      await banned.authenticate(request(`Bearer ${VALID_KEY}`))
    ).toMatchObject({ ok: false, failure: { status: 403 } })

    const stillBanned = setup({
      findUser: async () =>
        makeUser({
          banned: true,
          banExpires: new Date("2026-10-13T00:00:00Z"),
        }),
    })
    expect(
      await stillBanned.authenticate(request(`Bearer ${VALID_KEY}`))
    ).toMatchObject({ ok: false, failure: { status: 403 } })

    const banOver = setup({
      findUser: async () =>
        makeUser({
          banned: true,
          banExpires: new Date("2026-10-11T00:00:00Z"),
        }),
    })
    expect(
      (await banOver.authenticate(request(`Bearer ${VALID_KEY}`))).ok
    ).toBe(true)
  })

  it("blocks a user who left the key's organization", async () => {
    const memberships: unknown[] = []
    const { authenticate } = setup({
      isMember: (input) => {
        memberships.push(input)
        return Promise.resolve(false)
      },
    })

    expect(await authenticate(request(`Bearer ${VALID_KEY}`))).toMatchObject({
      ok: false,
      failure: { status: 403, code: "access_denied" },
    })
    expect(memberships).toEqual([{ organizationId: "org_a", userId: "user_1" }])
  })
})
