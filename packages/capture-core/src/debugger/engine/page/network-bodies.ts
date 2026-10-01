import { MAX_BODY_LENGTH } from "./constants"
import type { Reporter } from "./types"
import { sanitizeCapturedBody, toAbsoluteUrl } from "./utils"

// Response bodies for fetch and XHR. The service worker already records every
// request through webRequest, but it cannot read response bodies, so this adds
// them while a tab is recording.
//
// An earlier always-on version broke Gmail uploads, Cloudflare challenges and
// Medium. So this one is only installed while the tab is recording, is removed
// when recording ends, never touches window.Request or request bodies, returns
// the page's own fetch promise untouched, and only reads text-like responses,
// a bounded amount at a time.

export interface NetworkBodyEvent {
  kind: "network-body"
  timestamp: number
  method: string
  url: string
  status: number
  responseBody: string
}

interface NetworkBodyCaptureInput {
  reporter: Reporter
  postBody: (event: NetworkBodyEvent) => void
}

export interface NetworkBodyCapture {
  enable: () => void
  disable: () => void
}

// Read at most this much of a response. Enough to parse and redact typical
// JSON before it is cut down to MAX_BODY_LENGTH.
const MAX_READ_CHARS = 64 * 1024
const MAX_BODIES_PER_SECOND = 20
const TEXT_CONTENT_TYPE_PATTERN =
  /json|xml|javascript|graphql|x-www-form-urlencoded|^text\//i

export function createNetworkBodyCapture(
  input: NetworkBodyCaptureInput
): NetworkBodyCapture {
  const { reporter, postBody } = input
  const isWithinBudget = createBudget(MAX_BODIES_PER_SECOND)

  const post = (event: Omit<NetworkBodyEvent, "kind" | "timestamp">) => {
    if (!(event.responseBody && isWithinBudget())) {
      return
    }

    try {
      postBody({ kind: "network-body", timestamp: Date.now(), ...event })
    } catch (error) {
      reporter.reportNonFatalError(
        "Failed to post network body in debugger instrumentation",
        error
      )
    }
  }

  let restore: (() => void) | null = null

  return {
    enable() {
      if (restore) {
        return
      }

      const restoreFetch = hookFetch(reporter, post)
      const restoreXhr = hookXhr(reporter, post)
      restore = () => {
        restoreFetch()
        restoreXhr()
      }
    },
    disable() {
      restore?.()
      restore = null
    },
  }
}

type PostBody = (event: Omit<NetworkBodyEvent, "kind" | "timestamp">) => void

function hookFetch(reporter: Reporter, post: PostBody): () => void {
  const originalFetch = window.fetch
  if (typeof originalFetch !== "function") {
    return () => undefined
  }

  const wrappedFetch = function (
    this: unknown,
    ...args: Parameters<typeof fetch>
  ) {
    const promise = originalFetch.apply(this, args)

    // The page gets the exact promise the browser returned; reading the body
    // copy happens on the side.
    promise.then(
      (response) => {
        captureFetchResponse(reporter, post, args, response).catch(
          () => undefined
        )
      },
      () => undefined
    )

    return promise
  } as typeof fetch

  window.fetch = wrappedFetch

  return () => {
    // Leave it alone if the page wrapped fetch again after us.
    if (window.fetch === wrappedFetch) {
      window.fetch = originalFetch
    }
  }
}

async function captureFetchResponse(
  reporter: Reporter,
  post: PostBody,
  args: Parameters<typeof fetch>,
  response: Response
): Promise<void> {
  if (response.type === "opaque" || response.bodyUsed || !response.body) {
    return
  }

  const contentType = response.headers.get("content-type") ?? ""
  if (!isTextContentType(contentType)) {
    return
  }

  const [input, init] = args
  const requestUrl =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase()
  const url = toAbsoluteUrl(requestUrl, reporter) ?? requestUrl

  let text: string
  try {
    text = await readBounded(response.clone())
  } catch {
    return
  }

  post({
    method,
    url,
    status: response.status,
    responseBody: sanitizeCapturedBody(text, contentType)?.slice(
      0,
      MAX_BODY_LENGTH
    ) as string,
  })
}

// Reads the start of a body without buffering the rest, so streams and large
// downloads cost nothing extra.
async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    return ""
  }

  const decoder = new TextDecoder()
  let text = ""
  try {
    while (text.length < MAX_READ_CHARS) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.cancel().catch(() => undefined)
  }

  return text.slice(0, MAX_READ_CHARS)
}

interface XhrInfo {
  method: string
  url: string
}

function hookXhr(reporter: Reporter, post: PostBody): () => void {
  if (typeof XMLHttpRequest !== "function") {
    return () => undefined
  }

  const prototype = XMLHttpRequest.prototype
  const originalOpen = prototype.open
  const originalSend = prototype.send
  const infoByXhr = new WeakMap<XMLHttpRequest, XhrInfo>()

  const wrappedOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    infoByXhr.set(this, {
      method: String(method).toUpperCase(),
      url: toAbsoluteUrl(String(url), reporter) ?? String(url),
    })
    // Same arguments, same count: open() behaves differently with 2 and 5.
    return (originalOpen as (...args: unknown[]) => void).apply(this, [
      method,
      url,
      ...rest,
    ])
  } as typeof prototype.open

  const wrappedSend = function (
    this: XMLHttpRequest,
    ...args: Parameters<typeof prototype.send>
  ) {
    const info = infoByXhr.get(this)
    if (info) {
      this.addEventListener(
        "loadend",
        () => {
          captureXhrResponse(post, this, info)
        },
        { once: true }
      )
    }

    return originalSend.apply(this, args)
  }

  prototype.open = wrappedOpen
  prototype.send = wrappedSend

  return () => {
    if (prototype.open === wrappedOpen) {
      prototype.open = originalOpen
    }
    if (prototype.send === wrappedSend) {
      prototype.send = originalSend
    }
  }
}

function captureXhrResponse(
  post: PostBody,
  xhr: XMLHttpRequest,
  info: XhrInfo
): void {
  try {
    if (xhr.status === 0) {
      return
    }

    const contentType = xhr.getResponseHeader("content-type") ?? ""
    let text: string | null = null

    // responseText throws for any other responseType.
    if (xhr.responseType === "" || xhr.responseType === "text") {
      text = isTextContentType(contentType) ? xhr.responseText : null
    } else if (xhr.responseType === "json" && xhr.response !== null) {
      text = JSON.stringify(xhr.response)
    }

    if (!text) {
      return
    }

    post({
      method: info.method,
      url: info.url,
      status: xhr.status,
      responseBody: sanitizeCapturedBody(
        text.slice(0, MAX_READ_CHARS),
        contentType || "application/json"
      )?.slice(0, MAX_BODY_LENGTH) as string,
    })
  } catch {
    // Reading a response must never break the page.
  }
}

function isTextContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase()
  return (
    TEXT_CONTENT_TYPE_PATTERN.test(normalized) &&
    !normalized.includes("event-stream")
  )
}

function createBudget(perSecond: number): () => boolean {
  let windowStartedAt = 0
  let used = 0

  return () => {
    const now = Date.now()
    if (now - windowStartedAt >= 1000) {
      windowStartedAt = now
      used = 0
    }

    if (used >= perSecond) {
      return false
    }

    used += 1
    return true
  }
}
