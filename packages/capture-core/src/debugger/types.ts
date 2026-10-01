import type {
  DISCARD_SESSION_MESSAGE,
  ENSURE_PAGE_RUNTIME_MESSAGE,
  GET_CAPTURE_STATE_MESSAGE,
  GET_SESSION_SNAPSHOT_MESSAGE,
  MARK_RECORDING_STARTED_MESSAGE,
  MARK_RECORDING_STOPPED_MESSAGE,
  PAGE_BRIDGE_SOURCE,
  PAGE_EVENT_MESSAGE,
  PAGE_EVENTS_MESSAGE,
  START_SESSION_MESSAGE,
} from "./constants"

export type DebuggerCaptureType = "video" | "screenshot"

export type DebuggerActionType =
  | "click"
  | "input"
  | "change"
  | "submit"
  | "keydown"
  | "navigation"

// Which browser tab an event came from. Set by the background worker, never
// trusted from the page.
export interface DebuggerEventTabContext {
  tabId?: number
  pageUrl?: string
}

export interface DebuggerActionEvent extends DebuggerEventTabContext {
  kind: "action"
  timestamp: number
  actionType: DebuggerActionType | string
  target?: string
  metadata?: Record<string, unknown>
}

export interface DebuggerConsoleEvent extends DebuggerEventTabContext {
  kind: "console"
  timestamp: number
  level: "log" | "info" | "warn" | "error" | "debug"
  message: string
  metadata?: Record<string, unknown>
}

export interface DebuggerNetworkEvent extends DebuggerEventTabContext {
  kind: "network"
  timestamp: number
  method: string
  url: string
  status?: number
  duration?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  // Why the request failed, e.g. "Likely CORS error" or "net::ERR_ABORTED".
  failure?: string
}

export type DebuggerEvent =
  | DebuggerActionEvent
  | DebuggerConsoleEvent
  | DebuggerNetworkEvent

export interface DebuggerSessionTab {
  tabId: number
  url?: string
  title?: string
  joinedAt: number
}

export interface DebuggerSessionSnapshot {
  sessionId: string
  captureTabId: number
  captureType: DebuggerCaptureType
  startedAt: number
  recordingStartedAt: number | null
  // Events after this are not part of the report.
  recordingStoppedAt?: number | null
  tabs: DebuggerSessionTab[]
  events: DebuggerEvent[]
}

export interface BugReportDebuggerPayload {
  actions: Array<
    DebuggerEventTabContext & {
      type: string
      target?: string
      timestamp: string
      offset: number | null
      metadata?: Record<string, unknown>
    }
  >
  logs: Array<
    DebuggerEventTabContext & {
      level: "log" | "info" | "warn" | "error" | "debug"
      message: string
      timestamp: string
      offset: number | null
      metadata?: Record<string, unknown>
    }
  >
  networkRequests: Array<
    DebuggerEventTabContext & {
      method: string
      url: string
      status?: number
      duration?: number
      requestHeaders?: Record<string, string>
      responseHeaders?: Record<string, string>
      requestBody?: string
      responseBody?: string
      failure?: string
      timestamp: string
      offset: number | null
    }
  >
}

export interface DebuggerStartSessionResponse {
  sessionId: string
  startedAt: number
}

export interface DebuggerRuntimeSuccess<TData = undefined> {
  ok: true
  data: TData
}

export interface DebuggerRuntimeFailure {
  ok: false
  error: string
}

export type DebuggerRuntimeResponse<TData = undefined> =
  | DebuggerRuntimeSuccess<TData>
  | DebuggerRuntimeFailure

export interface DebuggerStartSessionMessage {
  type: typeof START_SESSION_MESSAGE
  payload: {
    captureTabId: number
    captureType: DebuggerCaptureType
    instantReplayLookbackMs?: number
    followTabs?: boolean
  }
}

export interface DebuggerMarkRecordingStartedMessage {
  type: typeof MARK_RECORDING_STARTED_MESSAGE
  payload: {
    sessionId: string
    recordingStartedAt: number
  }
}

export interface DebuggerMarkRecordingStoppedMessage {
  type: typeof MARK_RECORDING_STOPPED_MESSAGE
  payload: {
    sessionId: string
    recordingStoppedAt: number
  }
}

export interface DebuggerGetSessionSnapshotMessage {
  type: typeof GET_SESSION_SNAPSHOT_MESSAGE
  payload: {
    sessionId: string
  }
}

export interface DebuggerDiscardSessionMessage {
  type: typeof DISCARD_SESSION_MESSAGE
  payload: {
    sessionId: string
  }
}

export interface DebuggerPageEventMessage {
  type: typeof PAGE_EVENT_MESSAGE
  payload: {
    event: unknown
  }
}

export interface DebuggerPageEventsMessage {
  type: typeof PAGE_EVENTS_MESSAGE
  payload: {
    events: unknown[]
  }
}

export interface DebuggerEnsurePageRuntimeMessage {
  type: typeof ENSURE_PAGE_RUNTIME_MESSAGE
  payload?: Record<string, never>
}

export interface DebuggerGetCaptureStateMessage {
  type: typeof GET_CAPTURE_STATE_MESSAGE
  payload?: Record<string, never>
}

export interface DebuggerCaptureState {
  networkBodies: boolean
}

export type DebuggerRuntimeMessage =
  | DebuggerStartSessionMessage
  | DebuggerMarkRecordingStartedMessage
  | DebuggerMarkRecordingStoppedMessage
  | DebuggerGetSessionSnapshotMessage
  | DebuggerDiscardSessionMessage
  | DebuggerPageEventMessage
  | DebuggerPageEventsMessage
  | DebuggerEnsurePageRuntimeMessage
  | DebuggerGetCaptureStateMessage

export interface DebuggerContentBridgePayload {
  source: typeof PAGE_BRIDGE_SOURCE
  event?: unknown
  events?: unknown[]
}

export interface StoredDebuggerSession {
  sessionId: string
  captureTabId: number
  captureType: DebuggerCaptureType
  startedAt: number
  recordingStartedAt: number | null
  recordingStoppedAt: number | null
  // Record Full Screen follows the user into other tabs; Record This Tab
  // only ever covers the capture tab.
  followTabs: boolean
  // The extension page that records this session. Closing it discards the
  // session, since nothing can submit it anymore.
  recorderTabId: number | null
  // The tab the user is on, and the tab the last tab-switch event pointed at.
  // They differ while a just-opened tab has no URL yet. Stored so a worker
  // restart does not lose them.
  activeTabId: number | null
  lastSwitchTabId: number | null
  tabs: DebuggerSessionTab[]
  events: DebuggerEvent[]
}
