import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"

/**
 * Hard cap for one tool result. Claude Code warns above ~25k tokens, and JSON
 * runs at roughly 3 characters per token.
 */
export const MAX_TOOL_RESULT_CHARS = 60_000

export function truncateText(value: string, maxChars: number): string
export function truncateText(
  value: string | null | undefined,
  maxChars: number
): string | null
export function truncateText(
  value: string | null | undefined,
  maxChars: number
): string | null {
  if (typeof value !== "string") {
    return null
  }

  if (value.length <= maxChars) {
    return value
  }

  const omitted = value.length - maxChars
  return `${value.slice(0, maxChars)}… [${omitted} more characters]`
}

/** Shows unknown JSON (metadata, headers) compactly, within a size cap. */
export function compactJson(value: unknown, maxChars: number): unknown {
  if (value === null || value === undefined) {
    return null
  }

  const serialized = JSON.stringify(value)
  if (serialized === undefined || serialized.length <= maxChars) {
    return value
  }

  return truncateText(serialized, maxChars)
}

/** Formats a time offset from the start of the recording, e.g. `1:05.3`. */
export function formatOffset(
  offsetMs: number | null | undefined
): string | null {
  if (typeof offsetMs !== "number" || !Number.isFinite(offsetMs)) {
    return null
  }

  const safeMs = Math.max(0, Math.round(offsetMs))
  const minutes = Math.floor(safeMs / 60_000)
  const seconds = Math.floor((safeMs % 60_000) / 1000)
  const tenths = Math.floor((safeMs % 1000) / 100)
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${tenths}`
}

export function isFailedNetworkRequest(request: {
  status: number | null
  failure: string | null
}): boolean {
  if (request.failure) {
    return true
  }

  return request.status === 0 || (request.status ?? 0) >= 400
}

export function jsonResult(value: unknown): CallToolResult {
  const text = JSON.stringify(value, null, 2)

  return {
    content: [
      {
        type: "text",
        text: truncateText(text, MAX_TOOL_RESULT_CHARS),
      },
    ],
  }
}

/**
 * Returns one page of a list, dropping items from the end until the result
 * fits under the hard cap, so the caller always gets valid JSON and a
 * `nextOffset` to continue from.
 */
export function pagedResult<T>(input: {
  items: T[]
  offset: number
  total: number
  extra?: Record<string, unknown>
}): CallToolResult {
  let shown = input.items.length

  for (;;) {
    const page = input.items.slice(0, shown)
    const nextOffset = input.offset + page.length
    const value = {
      total: input.total,
      ...input.extra,
      offset: input.offset,
      items: page,
      hasMore: nextOffset < input.total,
      ...(nextOffset < input.total ? { nextOffset } : {}),
      ...(shown < input.items.length
        ? {
            note: `Only ${shown} of the requested ${input.items.length} items fit in one result. Continue from nextOffset.`,
          }
        : {}),
    }
    const text = JSON.stringify(value, null, 2)

    if (text.length <= MAX_TOOL_RESULT_CHARS || shown <= 1) {
      return jsonResult(value)
    }

    shown = Math.max(1, Math.floor(shown / 2))
  }
}

export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  }
}

export function clampInteger(
  value: number | undefined,
  options: { min: number; max: number; fallback: number }
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return options.fallback
  }

  return Math.min(options.max, Math.max(options.min, Math.floor(value)))
}
