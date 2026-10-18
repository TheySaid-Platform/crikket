import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"

import type {
  McpAuthFailure,
  McpAuthResult,
  McpRateLimitDecision,
} from "./auth"
import type { VideoFrameService } from "./media/video-frames"
import type { CrikketReader } from "./reader"
import { createCrikketMcpServer } from "./server"
import { buildMcpSessionContext } from "./session"
import type { SessionContext } from "./types"

/** MCP requests are small JSON-RPC messages; anything bigger is refused. */
export const MAX_MCP_REQUEST_BODY_BYTES = 1024 * 1024
const AUTH_REALM = "crikket"
const JSON_RPC_SERVER_ERROR = -32_001
const JSON_RPC_PARSE_ERROR = -32_700
const JSON_RPC_INTERNAL_ERROR = -32_603

export interface McpRequestHandlerDependencies {
  appOrigin: string
  /** Shared by every request, so its cache and limits are per pod. */
  frames?: VideoFrameService
  authenticate: (request: Request) => Promise<McpAuthResult>
  createReader: (session: SessionContext) => CrikketReader
  /** Per-user limit, checked once the access key is verified. */
  limitUser?: (input: {
    request: Request
    userId: string
  }) => Promise<McpRateLimitDecision>
}

/**
 * Stateless Streamable HTTP: every POST gets a fresh server and transport,
 * authenticated by the access key on that request. There is no MCP session
 * to keep, so GET (server-to-client stream) and DELETE are not supported.
 */
export function createMcpRequestHandler(deps: McpRequestHandlerDependencies) {
  return async function handleMcpRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return jsonRpcError(405, JSON_RPC_SERVER_ERROR, "Method not allowed.", {
        allow: "POST",
      })
    }

    let auth: McpAuthResult
    let limit: McpRateLimitDecision | undefined
    try {
      auth = await deps.authenticate(request)
      if (!auth.ok) {
        return authFailureResponse(auth.failure)
      }

      limit = await deps.limitUser?.({
        request,
        userId: auth.principal.user.id,
      })
    } catch (error) {
      console.error("[mcp] failed to authenticate request", error)
      return jsonRpcError(500, JSON_RPC_INTERNAL_ERROR, "Internal error.")
    }

    if (limit && !limit.allowed) {
      return tooManyRequests(limit.retryAfterSeconds)
    }

    const body = await readBody(request)
    if (!body.ok) {
      return body.response
    }

    const session = buildMcpSessionContext({
      principal: auth.principal,
      userAgent: request.headers.get("user-agent"),
    })
    const server = createCrikketMcpServer({
      appOrigin: deps.appOrigin,
      frames: deps.frames,
      reader: deps.createReader(session),
    })
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    try {
      await server.connect(transport)
      return await transport.handleRequest(request, {
        parsedBody: body.value,
      })
    } finally {
      await server.close()
    }
  }
}

async function readBody(
  request: Request
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const declaredLength = Number(request.headers.get("content-length"))
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_MCP_REQUEST_BODY_BYTES
  ) {
    return { ok: false, response: payloadTooLarge() }
  }

  const text = await readTextWithin(request, MAX_MCP_REQUEST_BODY_BYTES)
  if (text === null) {
    return { ok: false, response: payloadTooLarge() }
  }

  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return {
      ok: false,
      response: jsonRpcError(
        400,
        JSON_RPC_PARSE_ERROR,
        "Parse error: invalid JSON."
      ),
    }
  }
}

/** Reads the body as text, giving up as soon as it passes `maxBytes`. */
async function readTextWithin(
  request: Request,
  maxBytes: number
): Promise<string | null> {
  if (!request.body) {
    return ""
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  return new TextDecoder().decode(Buffer.concat(chunks))
}

function payloadTooLarge(): Response {
  return jsonRpcError(
    413,
    JSON_RPC_SERVER_ERROR,
    `Request body exceeds ${MAX_MCP_REQUEST_BODY_BYTES} bytes.`
  )
}

export function tooManyRequests(retryAfterSeconds: number): Response {
  return jsonRpcError(
    429,
    JSON_RPC_SERVER_ERROR,
    `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
    { "retry-after": String(retryAfterSeconds) }
  )
}

function authFailureResponse(failure: McpAuthFailure): Response {
  const headers: Record<string, string> = {}

  if (failure.status === 401) {
    headers["www-authenticate"] =
      failure.code === "missing_token"
        ? `Bearer realm="${AUTH_REALM}"`
        : `Bearer realm="${AUTH_REALM}", error="invalid_token", error_description="${failure.message}"`
  }

  if (failure.status === 429) {
    headers["retry-after"] = String(failure.retryAfterSeconds)
  }

  return jsonRpcError(
    failure.status,
    JSON_RPC_SERVER_ERROR,
    failure.message,
    headers
  )
}

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  headers: Record<string, string> = {}
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code, message },
      id: null,
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
    }
  )
}
