import { createHash } from "node:crypto"
import { isIP } from "node:net"
import { env } from "@crikket/env/server"
import { MCP_ENDPOINT_PATH } from "@crikket/shared/constants/mcp"
import { ORPCError } from "@orpc/client"
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

const RPC_ROUTE_PREFIX = "/rpc/"
const RATE_LIMITED_PATH_PREFIXES = [RPC_ROUTE_PREFIX, MCP_ENDPOINT_PATH]
const CLIENT_ID_FALLBACK = "anonymous"
const RATE_LIMIT_CONFIG = {
  windowSeconds: 60,
  ipMax: 180,
  userMax: 120,
  prefix: "crikket:rate-limit",
} as const

// MCP traffic gets its own counters, so an AI session paging through a
// report never uses up the same user's dashboard budget, and the reverse.
type RateLimitBucket = "rpc" | "mcp"
const RATE_LIMIT_ERROR_LOG_INTERVAL_MS = 60_000

type RateLimitHeaders = Record<string, string>

type AllowedRateLimitDecision = {
  allowed: true
  headers: RateLimitHeaders
}

export type BlockedRateLimitDecision = {
  allowed: false
  headers: RateLimitHeaders
  retryAfterSeconds: number
  message: string
}

export type RpcRateLimitDecision =
  | AllowedRateLimitDecision
  | BlockedRateLimitDecision

type RateLimiters = {
  ip: Ratelimit
  user: Ratelimit
}

type RateLimitResult = {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

const rateLimitersByBucket = new Map<RateLimitBucket, RateLimiters>()
let lastRateLimitErrorLoggedAt = 0

function getRateLimitWindow(windowSeconds: number): `${number} s` {
  return `${windowSeconds} s`
}

function hasUpstashConfig(): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN)
}

function getRateLimiters(bucket: RateLimitBucket): RateLimiters | null {
  if (!hasUpstashConfig()) {
    return null
  }

  const existing = rateLimitersByBucket.get(bucket)
  if (existing) {
    return existing
  }

  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  })

  const rpcWindow = getRateLimitWindow(RATE_LIMIT_CONFIG.windowSeconds)

  const limiters = {
    ip: new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(RATE_LIMIT_CONFIG.ipMax, rpcWindow),
      prefix: `${RATE_LIMIT_CONFIG.prefix}:${bucket}:ip`,
    }),
    user: new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(RATE_LIMIT_CONFIG.userMax, rpcWindow),
      prefix: `${RATE_LIMIT_CONFIG.prefix}:${bucket}:user`,
    }),
  }
  rateLimitersByBucket.set(bucket, limiters)

  return limiters
}

function normalizeIpCandidate(value: string): string | null {
  let candidate = value.trim()
  if (!candidate) {
    return null
  }

  if (candidate.startsWith("for=")) {
    candidate = candidate.slice(4)
  }

  candidate = candidate.replace(/^"+|"+$/g, "")

  if (candidate.startsWith("[")) {
    const end = candidate.indexOf("]")
    if (end > 0) {
      candidate = candidate.slice(1, end)
    }
  }

  if (candidate.startsWith("::ffff:")) {
    candidate = candidate.slice(7)
  }

  if (
    candidate.includes(".") &&
    candidate.includes(":") &&
    candidate.lastIndexOf(":") > candidate.indexOf(".")
  ) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"))
  }

  return isIP(candidate) ? candidate : null
}

function getClientIp(request: Request): string | null {
  const directHeaders = [
    "cf-connecting-ip",
    "x-real-ip",
    "fly-client-ip",
  ] as const

  for (const headerName of directHeaders) {
    const raw = request.headers.get(headerName)
    if (!raw) {
      continue
    }

    const ip = normalizeIpCandidate(raw)
    if (ip) {
      return ip
    }
  }

  return null
}

function getFallbackFingerprint(request: Request): string {
  const source = [
    request.headers.get("user-agent")?.trim() ?? "",
    request.headers.get("accept-language")?.trim() ?? "",
    request.headers.get("sec-ch-ua")?.trim() ?? "",
    request.headers.get("sec-ch-ua-platform")?.trim() ?? "",
  ].join("|")

  if (!source.replace(/\|/g, "")) {
    return CLIENT_ID_FALLBACK
  }

  return createHash("sha256").update(source).digest("hex").slice(0, 16)
}

function getIpIdentifier(request: Request): string {
  const ip = getClientIp(request)
  if (ip) {
    return ip
  }

  return `fp:${getFallbackFingerprint(request)}`
}

function getRateLimitHeaders(limit: number, remaining: number, reset: number) {
  return {
    "x-ratelimit-limit": String(limit),
    "x-ratelimit-remaining": String(Math.max(remaining, 0)),
    "x-ratelimit-reset": String(Math.ceil(reset / 1000)),
  }
}

function getRateLimitExceededMessage(): string {
  return "Too many requests. Please try again soon."
}

function getRateLimitKey(options: {
  scope: "ip" | "user"
  identifier: string
}): string {
  return `${options.scope}:${options.identifier}`
}

function getStrictestResult(results: [RateLimitResult, ...RateLimitResult[]]) {
  return results.reduce((strictest, current) => {
    const strictestRatio = strictest.remaining / strictest.limit
    const currentRatio = current.remaining / current.limit

    if (currentRatio < strictestRatio) {
      return current
    }

    if (
      currentRatio === strictestRatio &&
      current.remaining < strictest.remaining
    ) {
      return current
    }

    return strictest
  })
}

function getRetryAfterSeconds(reset: number): number {
  return Math.max(1, Math.ceil((reset - Date.now()) / 1000))
}

function toBlockedRateLimitDecision(
  result: RateLimitResult
): BlockedRateLimitDecision {
  const retryAfterSeconds = getRetryAfterSeconds(result.reset)

  return {
    allowed: false,
    retryAfterSeconds,
    message: getRateLimitExceededMessage(),
    headers: {
      ...getRateLimitHeaders(result.limit, result.remaining, result.reset),
      "retry-after": String(retryAfterSeconds),
    },
  }
}

function logRateLimitError(error: unknown): void {
  const now = Date.now()
  if (now - lastRateLimitErrorLoggedAt < RATE_LIMIT_ERROR_LOG_INTERVAL_MS) {
    return
  }

  lastRateLimitErrorLoggedAt = now
  console.error(
    "[rate-limit] Upstash limiter failed; continuing without block",
    {
      error,
    }
  )
}

async function limitWithFailOpen(
  limiter: Ratelimit,
  key: string
): Promise<RateLimitResult | null> {
  try {
    return await limiter.limit(key)
  } catch (error) {
    logRateLimitError(error)
    return null
  }
}

export async function evaluateRpcRateLimit(
  request: Request,
  options?: {
    userId?: string | null
    skipIp?: boolean
    skipUser?: boolean
  }
): Promise<RpcRateLimitDecision> {
  if (request.method === "OPTIONS") {
    return { allowed: true, headers: {} }
  }

  const pathname = new URL(request.url).pathname
  if (
    !RATE_LIMITED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return { allowed: true, headers: {} }
  }

  const limiters = getRateLimiters(
    pathname.startsWith(MCP_ENDPOINT_PATH) ? "mcp" : "rpc"
  )
  if (!limiters) {
    return { allowed: true, headers: {} }
  }

  const userId = options?.userId?.trim() || null
  const results: RateLimitResult[] = []
  const shouldCheckUser = !options?.skipUser && Boolean(userId)
  const shouldCheckIp = !options?.skipIp

  if (shouldCheckUser && userId) {
    const userResult = await limitWithFailOpen(
      limiters.user,
      getRateLimitKey({
        scope: "user",
        identifier: userId,
      })
    )

    if (userResult) {
      results.push(userResult)

      if (!userResult.success) {
        return toBlockedRateLimitDecision(userResult)
      }
    }
  }

  if (shouldCheckIp) {
    const ipResult = await limitWithFailOpen(
      limiters.ip,
      getRateLimitKey({
        scope: "ip",
        identifier: getIpIdentifier(request),
      })
    )

    if (ipResult) {
      results.push(ipResult)

      if (!ipResult.success) {
        return toBlockedRateLimitDecision(ipResult)
      }
    }
  }

  if (results.length === 0) {
    return { allowed: true, headers: {} }
  }

  const strictest = getStrictestResult(
    results as [RateLimitResult, ...RateLimitResult[]]
  )
  const headers = getRateLimitHeaders(
    strictest.limit,
    strictest.remaining,
    strictest.reset
  )

  return { allowed: true, headers }
}

export function buildRpcRateLimitErrorResponse(
  decision: BlockedRateLimitDecision
): Response {
  const error = new ORPCError("TOO_MANY_REQUESTS", {
    message: decision.message,
    data: {
      retryAfterSeconds: decision.retryAfterSeconds,
    },
  })

  return new Response(JSON.stringify(error.toJSON()), {
    status: error.status,
    headers: {
      "content-type": "application/json",
      ...decision.headers,
    },
  })
}
