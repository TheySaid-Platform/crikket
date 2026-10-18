import { db } from "@crikket/db"
import { rateLimit } from "@crikket/db/schema/auth"
import { MCP_ACCESS_KEY_RATE_LIMIT } from "@crikket/shared/constants/mcp"
import { sql } from "drizzle-orm"

import type { McpRateLimitDecision } from "./auth"
import { decideKeyRateLimit } from "./key-rate-limit-policy"

const RATE_LIMIT_KEY_PREFIX = "mcp-access-key:"

/**
 * Counts one request for an access key in a fixed window and decides whether
 * it may run. One atomic upsert on better-auth's `rate_limit` table keeps the
 * count right across server pods without needing Redis. Our keys use their
 * own prefix, so they never collide with better-auth's per-path entries.
 */
export async function limitAccessKey(
  keyId: string,
  nowMs: number = Date.now()
): Promise<McpRateLimitDecision> {
  const { windowMs, maxRequests } = MCP_ACCESS_KEY_RATE_LIMIT
  const windowExpiredBefore = nowMs - windowMs
  const isNewWindow = sql`${rateLimit.lastRequest} <= ${windowExpiredBefore}`

  const [row] = await db
    .insert(rateLimit)
    .values({
      id: crypto.randomUUID(),
      key: `${RATE_LIMIT_KEY_PREFIX}${keyId}`,
      count: 1,
      lastRequest: nowMs,
    })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${isNewWindow} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${isNewWindow} then ${nowMs} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({
      count: rateLimit.count,
      windowStartMs: rateLimit.lastRequest,
    })

  if (!row) {
    return { allowed: true }
  }

  return decideKeyRateLimit({
    count: row.count,
    maxRequests,
    nowMs,
    windowMs,
    windowStartMs: Number(row.windowStartMs),
  })
}
