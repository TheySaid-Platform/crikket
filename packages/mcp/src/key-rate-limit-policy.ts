import type { McpRateLimitDecision } from "./auth"

/**
 * `count` is the number of requests in the window that started at
 * `windowStartMs`, including this one.
 */
export function decideKeyRateLimit(input: {
  count: number
  maxRequests: number
  nowMs: number
  windowMs: number
  windowStartMs: number
}): McpRateLimitDecision {
  if (input.count <= input.maxRequests) {
    return { allowed: true }
  }

  const windowEndsMs = input.windowStartMs + input.windowMs
  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((windowEndsMs - input.nowMs) / 1000)
    ),
  }
}
