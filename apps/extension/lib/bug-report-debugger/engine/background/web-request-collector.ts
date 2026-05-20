import type { DebuggerNetworkEvent } from "@crikket/capture-core/debugger/types"

const URL_FILTER: chrome.webRequest.RequestFilter = {
  urls: ["http://*/*", "https://*/*"],
}

const MAX_REQUEST_BODY_LENGTH = 4000
const MAX_PENDING_REQUESTS = 500

interface PendingRequest {
  tabId: number
  method: string
  url: string
  startedAt: number
  requestHeaders: Record<string, string>
  requestBody?: string
}

interface CollectorInput {
  onNetworkEvent: (tabId: number, event: DebuggerNetworkEvent) => void
  reportError: (context: string, error: unknown) => void
}

export function registerWebRequestCollector(input: CollectorInput): void {
  if (!chrome.webRequest) {
    return
  }

  const { onNetworkEvent, reportError } = input
  const pending = new Map<string, PendingRequest>()

  const evictOldestIfFull = () => {
    if (pending.size < MAX_PENDING_REQUESTS) {
      return
    }

    const oldestKey = pending.keys().next().value
    if (typeof oldestKey === "string") {
      pending.delete(oldestKey)
    }
  }

  const emit = (event: DebuggerNetworkEvent, tabId: number) => {
    try {
      onNetworkEvent(tabId, event)
    } catch (error) {
      reportError("Failed to emit webRequest debugger event", error)
    }
  }

  chrome.webRequest.onBeforeRequest.addListener(
    (details): undefined => {
      if (details.tabId < 0) return undefined

      evictOldestIfFull()

      pending.set(details.requestId, {
        tabId: details.tabId,
        method: details.method,
        url: details.url,
        startedAt: details.timeStamp,
        requestHeaders: {},
        requestBody: summarizeRequestBody(details.requestBody),
      })

      return undefined
    },
    URL_FILTER,
    ["requestBody"]
  )

  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      const entry = pending.get(details.requestId)
      if (!entry) return

      if (details.requestHeaders) {
        entry.requestHeaders = headersArrayToRecord(details.requestHeaders)
      }
    },
    URL_FILTER,
    ["requestHeaders"]
  )

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      const entry = pending.get(details.requestId)
      pending.delete(details.requestId)
      if (!entry) return

      emit(
        {
          kind: "network",
          timestamp: Math.floor(entry.startedAt),
          method: entry.method,
          url: entry.url,
          status: details.statusCode,
          duration: Math.max(
            0,
            Math.floor(details.timeStamp - entry.startedAt)
          ),
          requestHeaders: entry.requestHeaders,
          responseHeaders: headersArrayToRecord(details.responseHeaders),
          requestBody: entry.requestBody,
        },
        entry.tabId
      )
    },
    URL_FILTER,
    ["responseHeaders"]
  )

  chrome.webRequest.onErrorOccurred.addListener((details) => {
    const entry = pending.get(details.requestId)
    pending.delete(details.requestId)
    if (!entry) return

    emit(
      {
        kind: "network",
        timestamp: Math.floor(entry.startedAt),
        method: entry.method,
        url: entry.url,
        status: 0,
        duration: Math.max(0, Math.floor(details.timeStamp - entry.startedAt)),
        requestHeaders: entry.requestHeaders,
        requestBody: entry.requestBody,
        responseBody: details.error,
      },
      entry.tabId
    )
  }, URL_FILTER)
}

function headersArrayToRecord(
  headers: chrome.webRequest.HttpHeader[] | undefined
): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result

  for (const header of headers) {
    if (typeof header.name !== "string") continue

    const key = header.name.trim().toLowerCase()
    if (!key) continue

    const value = typeof header.value === "string" ? header.value : ""
    if (!value) continue

    result[key] = value
  }

  return result
}

type WebRequestBody = NonNullable<
  chrome.webRequest.OnBeforeRequestDetails["requestBody"]
>

function summarizeRequestBody(
  body: WebRequestBody | undefined
): string | undefined {
  if (!body) return undefined

  if (body.formData) {
    const keys = Object.keys(body.formData)
    if (keys.length === 0) return undefined
    return truncate(`[form-data] ${keys.join(",")}`)
  }

  if (Array.isArray(body.raw) && body.raw.length > 0) {
    return summarizeRawBody(body.raw)
  }

  return undefined
}

function summarizeRawBody(
  chunks: chrome.webRequest.UploadData[]
): string | undefined {
  let totalBytes = 0
  const decoded: string[] = []
  const decoder = new TextDecoder("utf-8", { fatal: false })

  for (const chunk of chunks) {
    if (!chunk.bytes) continue
    totalBytes += chunk.bytes.byteLength
    tryDecodeChunk(decoder, chunk.bytes, totalBytes, decoded)
  }

  const joined = decoded.join("")
  if (joined.trim().length > 0) {
    return truncate(joined)
  }

  return `[bytes:${totalBytes}]`
}

function tryDecodeChunk(
  decoder: TextDecoder,
  bytes: ArrayBuffer,
  totalBytes: number,
  decoded: string[]
): void {
  if (decoded.length >= 4) return
  if (totalBytes >= MAX_REQUEST_BODY_LENGTH * 2) return

  try {
    decoded.push(decoder.decode(bytes, { stream: true }))
  } catch {
    // Non-text payload; ignore — fall back to byte-count summary.
  }
}

function truncate(value: string): string {
  if (value.length <= MAX_REQUEST_BODY_LENGTH) return value
  return `${value.slice(0, MAX_REQUEST_BODY_LENGTH)}...`
}
