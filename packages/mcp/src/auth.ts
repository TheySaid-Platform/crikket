import { MCP_ACCESS_KEY_PREFIX } from "@crikket/shared/constants/mcp"

import type { McpPrincipal, SessionUser } from "./types"

const BEARER_PATTERN = /^Bearer\s+(.+)$/i

export interface VerifiedAccessKey {
  id: string
  userId: string
  organizationId: string | null
  expiresAt: Date | null
}

export type AccessKeyVerification =
  | { valid: true; key: VerifiedAccessKey }
  | { valid: false }

export type McpRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number }

export interface McpAuthDependencies {
  verifyAccessKey: (key: string) => Promise<AccessKeyVerification>
  /** Counts one request against the key's limit. */
  limitKey: (keyId: string) => Promise<McpRateLimitDecision>
  findUser: (userId: string) => Promise<SessionUser | null>
  isMember: (input: {
    organizationId: string
    userId: string
  }) => Promise<boolean>
  now?: () => Date
}

export type McpAuthFailure =
  | { status: 401; code: "missing_token" | "invalid_token"; message: string }
  | { status: 403; code: "access_denied"; message: string }
  | {
      status: 429
      code: "rate_limited"
      message: string
      retryAfterSeconds: number
    }

export type McpAuthResult =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; failure: McpAuthFailure }

export function extractBearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization")?.trim()
  if (!authorization) {
    return null
  }

  const token = BEARER_PATTERN.exec(authorization)?.[1]?.trim()
  return token && token.length > 0 ? token : null
}

function isBanned(user: SessionUser, now: Date): boolean {
  if (!user.banned) {
    return false
  }

  const banExpires = user.banExpires ? new Date(user.banExpires) : null
  return !banExpires || banExpires.getTime() > now.getTime()
}

const invalidToken = {
  status: 401,
  code: "invalid_token",
  message: "The access key is invalid, expired or revoked.",
} as const satisfies McpAuthFailure

/**
 * Resolves the user and organization an MCP request acts as. The key alone is
 * not enough: the user must still exist, not be banned, and still be a member
 * of the organization the key was created for.
 */
export function createMcpAuthenticator(deps: McpAuthDependencies) {
  return async function authenticate(request: Request): Promise<McpAuthResult> {
    const token = extractBearerToken(request.headers)
    if (!token) {
      return {
        ok: false,
        failure: {
          status: 401,
          code: "missing_token",
          message:
            "Missing access key. Send it as `Authorization: Bearer <key>`.",
        },
      }
    }

    if (!token.startsWith(MCP_ACCESS_KEY_PREFIX)) {
      return { ok: false, failure: invalidToken }
    }

    const verification = await deps.verifyAccessKey(token)
    if (!verification.valid) {
      return { ok: false, failure: invalidToken }
    }

    const { key } = verification
    if (!key.organizationId) {
      return { ok: false, failure: invalidToken }
    }

    const limit = await deps.limitKey(key.id)
    if (!limit.allowed) {
      return {
        ok: false,
        failure: {
          status: 429,
          code: "rate_limited",
          message: `Too many requests with this access key. Try again in ${limit.retryAfterSeconds} seconds.`,
          retryAfterSeconds: limit.retryAfterSeconds,
        },
      }
    }

    const user = await deps.findUser(key.userId)
    if (!user) {
      return { ok: false, failure: invalidToken }
    }

    const now = deps.now?.() ?? new Date()
    if (isBanned(user, now)) {
      return {
        ok: false,
        failure: {
          status: 403,
          code: "access_denied",
          message: "This account is banned.",
        },
      }
    }

    const isMember = await deps.isMember({
      organizationId: key.organizationId,
      userId: user.id,
    })
    if (!isMember) {
      return {
        ok: false,
        failure: {
          status: 403,
          code: "access_denied",
          message:
            "You are no longer a member of the organization this access key was created for.",
        },
      }
    }

    return {
      ok: true,
      principal: {
        keyExpiresAt: key.expiresAt,
        keyId: key.id,
        organizationId: key.organizationId,
        user,
      },
    }
  }
}
