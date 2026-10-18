/**
 * MCP (Model Context Protocol) access for AI tools such as Claude Code and
 * Cursor. Keys are personal: each one belongs to one user and one
 * organization, and only grants what that user can already read.
 */

/** Path of the MCP endpoint on the API server. */
export const MCP_ENDPOINT_PATH = "/api/mcp"

/** Prefix of every MCP access key, so leaked keys are easy to recognise. */
export const MCP_ACCESS_KEY_PREFIX = "crk_mcp_"

/** Permissions stored on every MCP access key. */
export const MCP_ACCESS_KEY_PERMISSIONS = {
  mcp: ["read"],
} as const satisfies Record<string, string[]>

export const MCP_ACCESS_KEY_NAME_MAX_LENGTH = 32

/** Most active keys one user may hold in one organization. */
export const MCP_ACCESS_KEY_MAX_PER_ORGANIZATION = 20

/**
 * Per-key limit over a fixed window. One AI tool call is one HTTP request.
 * It is read on every request, so a change applies to existing keys too.
 */
export const MCP_ACCESS_KEY_RATE_LIMIT = {
  windowMs: 60 * 1000,
  maxRequests: 120,
} as const

export const MCP_ACCESS_KEY_EXPIRY_OPTIONS = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
} as const

export type McpAccessKeyExpiry = keyof typeof MCP_ACCESS_KEY_EXPIRY_OPTIONS

export const DEFAULT_MCP_ACCESS_KEY_EXPIRY: McpAccessKeyExpiry = "90d"
