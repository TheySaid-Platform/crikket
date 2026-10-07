import {
  MAX_NETWORK_BODY_LENGTH,
  MAX_TAB_TITLE_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_URL_LENGTH,
} from "./constants"
import type {
  DebuggerEvent,
  DebuggerEventTabContext,
  DebuggerSessionTab,
  StoredDebuggerSession,
} from "./types"

export interface StoredReplayBuffer {
  tabId: number
  lastTouchedAt: number
  events: DebuggerEvent[]
}

export function normalizeStoredSession(
  value: unknown
): StoredDebuggerSession | null {
  if (!isRecord(value)) return null

  const sessionId = asOptionalString(value.sessionId)
  const captureTabId = asOptionalNumber(value.captureTabId)
  const captureType = value.captureType
  const startedAt = asOptionalNumber(value.startedAt)
  const recordingStartedAt =
    value.recordingStartedAt === null
      ? null
      : asOptionalNumber(value.recordingStartedAt)
  const recorderTabId = asOptionalNumber(value.recorderTabId)
  const recordingStoppedAt = asOptionalNumber(value.recordingStoppedAt)
  const recordingPausedAt = asOptionalNumber(value.recordingPausedAt)
  const activeTabId = asOptionalNumber(value.activeTabId)
  const lastSwitchTabId = asOptionalNumber(value.lastSwitchTabId)

  if (!sessionId || captureTabId === undefined || startedAt === undefined) {
    return null
  }

  if (captureType !== "video" && captureType !== "screenshot") {
    return null
  }

  const events = Array.isArray(value.events)
    ? value.events.map(normalizeDebuggerEvent).filter(isDefined)
    : []

  // Sessions stored before multi-tab capture only know their capture tab.
  const tabs = Array.isArray(value.tabs)
    ? value.tabs.map(normalizeSessionTab).filter(isDefined)
    : []
  if (!tabs.some((tab) => tab.tabId === captureTabId)) {
    tabs.unshift({ tabId: captureTabId, joinedAt: startedAt })
  }

  return {
    sessionId,
    captureTabId,
    captureType,
    startedAt,
    recordingStartedAt: recordingStartedAt ?? null,
    recordingStoppedAt: recordingStoppedAt ?? null,
    recordingPausedAt: recordingPausedAt ?? null,
    followTabs: value.followTabs === true,
    recorderTabId: recorderTabId ?? null,
    backgroundRecorder: value.backgroundRecorder === true,
    activeTabId: activeTabId ?? null,
    lastSwitchTabId: lastSwitchTabId ?? null,
    tabs,
    events,
  }
}

function normalizeSessionTab(value: unknown): DebuggerSessionTab | null {
  if (!isRecord(value)) return null

  const tabId = asOptionalNumber(value.tabId)
  const joinedAt = asOptionalNumber(value.joinedAt)
  if (tabId === undefined || joinedAt === undefined) return null

  return {
    tabId,
    url: asOptionalString(value.url, MAX_URL_LENGTH),
    title: asOptionalString(value.title, MAX_TAB_TITLE_LENGTH),
    joinedAt,
  }
}

function normalizeTabContext(
  value: Record<string, unknown>
): DebuggerEventTabContext {
  const tabId = asOptionalNumber(value.tabId)
  const pageUrl = asOptionalString(value.pageUrl, MAX_URL_LENGTH)
  const context: DebuggerEventTabContext = {}

  if (tabId !== undefined && tabId >= 0) context.tabId = tabId
  if (pageUrl) context.pageUrl = pageUrl

  return context
}

export function normalizeDebuggerEvent(value: unknown): DebuggerEvent | null {
  if (!isRecord(value)) return null

  const kind = value.kind
  if (kind !== "action" && kind !== "console" && kind !== "network") {
    return null
  }

  const timestamp = asOptionalNumber(value.timestamp)
  if (timestamp === undefined) return null

  if (kind === "action") {
    const actionType = asOptionalString(value.actionType)
    if (!actionType) return null

    return {
      kind,
      timestamp,
      actionType,
      target: asOptionalString(value.target, MAX_TEXT_LENGTH),
      metadata: sanitizeRecord(value.metadata),
      ...normalizeTabContext(value),
    }
  }

  if (kind === "console") {
    const level = value.level
    if (
      level !== "log" &&
      level !== "info" &&
      level !== "warn" &&
      level !== "error" &&
      level !== "debug"
    ) {
      return null
    }

    const message = asOptionalString(value.message, MAX_TEXT_LENGTH)
    if (!message) return null

    return {
      kind,
      timestamp,
      level,
      message,
      metadata: sanitizeRecord(value.metadata),
      ...normalizeTabContext(value),
    }
  }

  const method = asOptionalString(value.method, 20)
  const url = asOptionalString(value.url, MAX_URL_LENGTH)
  if (!(method && url)) return null

  return {
    kind,
    timestamp,
    method,
    url,
    status: asOptionalNumber(value.status),
    duration: asOptionalNumber(value.duration),
    requestHeaders: sanitizeHeaders(value.requestHeaders),
    responseHeaders: sanitizeHeaders(value.responseHeaders),
    requestBody: asOptionalString(value.requestBody, MAX_NETWORK_BODY_LENGTH),
    responseBody: asOptionalString(value.responseBody, MAX_NETWORK_BODY_LENGTH),
    failure: asOptionalString(value.failure, 120),
    ...normalizeTabContext(value),
  }
}

function sanitizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined

  const result: Record<string, string> = {}

  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string") continue

    const normalizedKey = key.trim().toLowerCase()
    if (!normalizedKey || shouldHideHeader(normalizedKey)) {
      continue
    }

    result[normalizedKey.slice(0, 120)] = headerValue.slice(0, 500)
  }

  return Object.keys(result).length > 0 ? result : undefined
}

const SENSITIVE_HEADER_PATTERNS = [
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "session",
  "api-key",
  "apikey",
  "x-api-key",
  "refresh-token",
  "refresh_token",
  "access-token",
  "access_token",
  "id-token",
  "id_token",
  "client-secret",
  "client_secret",
] as const

function shouldHideHeader(headerName: string): boolean {
  if (headerName.includes("debugger")) return true

  return SENSITIVE_HEADER_PATTERNS.some((pattern) =>
    headerName.includes(pattern)
  )
}

function sanitizeRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined

  const result: Record<string, unknown> = {}

  for (const [key, entryValue] of Object.entries(value)) {
    const normalized = sanitizeJsonValue(entryValue)
    if (normalized === undefined) continue
    result[key.slice(0, 120)] = normalized
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return undefined

  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value
  }

  if (typeof value === "string") {
    return value.slice(0, MAX_TEXT_LENGTH)
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 30)
      .map((entry) => sanitizeJsonValue(entry, depth + 1))
      .filter(isDefined)
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {}

    for (const [key, entryValue] of Object.entries(value).slice(0, 30)) {
      const normalized = sanitizeJsonValue(entryValue, depth + 1)
      if (normalized === undefined) continue
      result[key.slice(0, 120)] = normalized
    }

    return result
  }

  return undefined
}

function asOptionalString(
  value: unknown,
  maxLength = MAX_TEXT_LENGTH
): string | undefined {
  if (typeof value !== "string") return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  return trimmed.slice(0, maxLength)
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }

  return Math.floor(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDefined<TValue>(value: TValue | null | undefined): value is TValue {
  return value !== null && value !== undefined
}

export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
}

export function normalizeStoredReplayBuffer(
  value: unknown
): StoredReplayBuffer | null {
  if (!isRecord(value)) return null

  const tabId = asOptionalNumber(value.tabId)
  const lastTouchedAt = asOptionalNumber(value.lastTouchedAt)
  if (
    tabId === undefined ||
    tabId < 0 ||
    lastTouchedAt === undefined ||
    lastTouchedAt < 0
  ) {
    return null
  }

  const events = Array.isArray(value.events)
    ? value.events.map(normalizeDebuggerEvent).filter(isDefined)
    : []

  return {
    tabId,
    lastTouchedAt,
    events,
  }
}
