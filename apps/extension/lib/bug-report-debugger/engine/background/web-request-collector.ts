import type { DebuggerNetworkEvent } from "@crikket/capture-core/debugger/types"

const URL_FILTER: chrome.webRequest.RequestFilter = {
  urls: ["http://*/*", "https://*/*"],
}

const MAX_REQUEST_BODY_LENGTH = 4000
const MAX_PENDING_REQUESTS = 500
const PENDING_STORAGE_KEY = "crikketDebuggerPendingRequests"

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

// The MV3 background service worker is terminated when idle (~30s), which wipes
// any in-memory state. Because a request is tracked across two events
// (onBeforeRequest -> onCompleted/onErrorOccurred), an in-memory-only map loses
// entries whenever the worker restarts mid-request, silently dropping the
// completed request. To avoid that, the pending map is mirrored to
// chrome.storage.session (in-memory across worker restarts within a browser
// session) and, as a last resort, the completion is emitted from the completion
// event's own fields so a request is never dropped entirely.
export function registerWebRequestCollector(input: CollectorInput): void {
  if (!chrome.webRequest) {
    return
  }

  const { onNetworkEvent, reportError } = input
  const pending = new Map<string, PendingRequest>()
  const sessionStorage = chrome.storage?.session

  const persistPending = () => {
    if (!sessionStorage) return
    const snapshot: Record<string, PendingRequest> = {}
    for (const [key, value] of pending) {
      snapshot[key] = value
    }
    sessionStorage.set({ [PENDING_STORAGE_KEY]: snapshot }).catch((error) => {
      reportError("Failed to persist pending webRequest map", error)
    })
  }

  const hydratePending = async () => {
    if (!sessionStorage) return
    try {
      const stored = await sessionStorage.get(PENDING_STORAGE_KEY)
      const snapshot = stored[PENDING_STORAGE_KEY] as
        | Record<string, PendingRequest>
        | undefined
      if (!snapshot) return
      for (const [key, value] of Object.entries(snapshot)) {
        if (!pending.has(key)) {
          pending.set(key, value)
        }
      }
    } catch (error) {
      reportError("Failed to hydrate pending webRequest map", error)
    }
  }

  // Kick off hydration once at startup so entries stored before a worker
  // restart are available to the completion handlers.
  const hydrated = hydratePending()

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

  // Resolve a pending entry, falling back to storage.session if the in-memory
  // map was wiped by a worker restart.
  const takePending = async (
    requestId: string
  ): Promise<PendingRequest | undefined> => {
    let entry = pending.get(requestId)
    if (!entry) {
      await hydrated
      entry = pending.get(requestId)
    }
    if (entry) {
      pending.delete(requestId)
      persistPending()
    }
    return entry
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
      persistPending()

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
        persistPending()
      }
    },
    URL_FILTER,
    ["requestHeaders"]
  )

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (details.tabId < 0) return

      takePending(details.requestId)
        .then((entry) => {
          emit(
            {
              kind: "network",
              timestamp: Math.floor(entry?.startedAt ?? details.timeStamp),
              method: entry?.method ?? details.method,
              url: entry?.url ?? details.url,
              status: details.statusCode,
              duration: Math.max(
                0,
                Math.floor(
                  details.timeStamp - (entry?.startedAt ?? details.timeStamp)
                )
              ),
              requestHeaders: entry?.requestHeaders,
              responseHeaders: headersArrayToRecord(details.responseHeaders),
              requestBody: entry?.requestBody,
            },
            entry?.tabId ?? details.tabId
          )
        })
        .catch((error) => {
          reportError("Failed to finalize completed webRequest", error)
        })
    },
    URL_FILTER,
    ["responseHeaders"]
  )

  chrome.webRequest.onErrorOccurred.addListener((details) => {
    if (details.tabId < 0) return

    takePending(details.requestId)
      .then((entry) => {
        emit(
          {
            kind: "network",
            timestamp: Math.floor(entry?.startedAt ?? details.timeStamp),
            method: entry?.method ?? details.method,
            url: entry?.url ?? details.url,
            status: 0,
            duration: Math.max(
              0,
              Math.floor(
                details.timeStamp - (entry?.startedAt ?? details.timeStamp)
              )
            ),
            requestHeaders: entry?.requestHeaders,
            requestBody: entry?.requestBody,
            responseBody: details.error,
          },
          entry?.tabId ?? details.tabId
        )
      })
      .catch((error) => {
        reportError("Failed to finalize errored webRequest", error)
      })
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
