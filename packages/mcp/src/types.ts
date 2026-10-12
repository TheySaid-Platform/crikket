import type { auth } from "@crikket/auth"

export type SessionContext = typeof auth.$Infer.Session

export type SessionUser = SessionContext["user"]

/** Who an MCP request acts as, resolved from a verified access key. */
export interface McpPrincipal {
  keyId: string
  keyExpiresAt: Date | null
  organizationId: string
  user: SessionUser
}
