import { isFailedNetworkRequest } from "./format"
import type { NetworkRequestItem } from "./reader"

const STATUS_CLASS_PATTERN = /^([1-5])xx$/i
const STATUS_CODE_PATTERN = /^\d{3}$/

export interface NetworkRequestFilters {
  failedOnly?: boolean
  /** "4xx", "5xx" or exact codes like "404". Any match passes. */
  statusCodes?: string[]
  methods?: string[]
  /** Host names; "example.com" also matches "api.example.com". */
  hosts?: string[]
  /** Parts of the response content type, e.g. "json" or "text/html". */
  contentTypes?: string[]
}

export type StatusFilterResult =
  | { ok: true; matches: (status: number | null) => boolean }
  | { ok: false; invalid: string[] }

export function parseStatusFilter(values: string[]): StatusFilterResult {
  const classes = new Set<number>()
  const codes = new Set<number>()
  const invalid: string[] = []

  for (const raw of values) {
    const value = raw.trim()
    const statusClass = STATUS_CLASS_PATTERN.exec(value)
    if (statusClass) {
      classes.add(Number(statusClass[1]))
    } else if (STATUS_CODE_PATTERN.test(value)) {
      codes.add(Number(value))
    } else {
      invalid.push(raw)
    }
  }

  if (invalid.length > 0) {
    return { ok: false, invalid }
  }

  return {
    ok: true,
    matches: (status) =>
      status !== null &&
      (codes.has(status) || classes.has(Math.floor(status / 100))),
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function contentTypeOf(request: NetworkRequestItem): string {
  for (const [name, value] of Object.entries(request.responseHeaders ?? {})) {
    if (name.toLowerCase() === "content-type") {
      return value.toLowerCase()
    }
  }
  return ""
}

/**
 * Builds one predicate from all filters: every filter given must pass, and
 * within one filter any listed value may match.
 */
export function buildNetworkRequestFilter(
  filters: NetworkRequestFilters,
  matchesStatus: ((status: number | null) => boolean) | null
): (request: NetworkRequestItem) => boolean {
  const methods = filters.methods?.length
    ? new Set(filters.methods.map((method) => method.trim().toUpperCase()))
    : null
  const hosts = filters.hosts?.length
    ? filters.hosts.map((host) => host.trim().toLowerCase())
    : null
  const contentTypes = filters.contentTypes?.length
    ? filters.contentTypes.map((type) => type.trim().toLowerCase())
    : null

  return (request) => {
    if (filters.failedOnly && !isFailedNetworkRequest(request)) {
      return false
    }
    if (matchesStatus && !matchesStatus(request.status)) {
      return false
    }
    if (methods && !methods.has(request.method.toUpperCase())) {
      return false
    }
    if (hosts) {
      const host = hostOf(request.url)
      if (
        !(
          host &&
          hosts.some((wanted) => host === wanted || host.endsWith(`.${wanted}`))
        )
      ) {
        return false
      }
    }
    if (contentTypes) {
      const contentType = contentTypeOf(request)
      if (!contentTypes.some((wanted) => contentType.includes(wanted))) {
        return false
      }
    }
    return true
  }
}
