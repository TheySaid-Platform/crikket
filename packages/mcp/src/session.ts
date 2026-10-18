import type { McpPrincipal, SessionContext } from "./types"

const FALLBACK_SESSION_LIFETIME_MS = 60 * 60 * 1000

/**
 * Builds the session the bug-report procedures expect, so MCP reads go
 * through exactly the same access rules as the web app. The session lives for
 * one request only and is never stored.
 */
export function buildMcpSessionContext(input: {
  principal: McpPrincipal
  now?: Date
  userAgent?: string | null
}): SessionContext {
  const now = input.now ?? new Date()
  const { principal } = input

  return {
    user: principal.user,
    session: {
      id: `mcp_${principal.keyId}`,
      token: "",
      userId: principal.user.id,
      activeOrganizationId: principal.organizationId,
      impersonatedBy: null,
      ipAddress: null,
      userAgent: input.userAgent ?? null,
      createdAt: now,
      updatedAt: now,
      expiresAt:
        principal.keyExpiresAt ??
        new Date(now.getTime() + FALLBACK_SESSION_LIFETIME_MS),
    },
  }
}
