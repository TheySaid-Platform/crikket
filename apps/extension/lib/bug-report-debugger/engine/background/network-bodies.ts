import { MAX_NETWORK_BODY_LENGTH } from "@crikket/capture-core/debugger/constants"
import { isRecordLike } from "@crikket/capture-core/debugger/normalize"
import type {
  DebuggerEvent,
  StoredDebuggerSession,
} from "@crikket/capture-core/debugger/types"

// Response bodies read in the page arrive separately from the webRequest
// event for the same request. This pairs them up: each body goes to the
// oldest matching request that has no body yet, so parallel identical calls
// are filled in order.

export interface NetworkBody {
  tabId: number
  method: string
  url: string
  status: number
  responseBody: string
  timestamp: number
}

// A body is read after its request started, possibly much later for slow
// responses.
const MATCH_WINDOW_MS = 60_000
// How long a body waits for its webRequest event before it is dropped.
const PENDING_TTL_MS = 10_000

export function toNetworkBody(raw: unknown, tabId: number): NetworkBody | null {
  if (!isRecordLike(raw) || raw.kind !== "network-body") {
    return null
  }

  const { method, url, status, responseBody, timestamp } = raw
  if (
    typeof method !== "string" ||
    typeof url !== "string" ||
    typeof status !== "number" ||
    typeof responseBody !== "string" ||
    typeof timestamp !== "number" ||
    responseBody.length === 0
  ) {
    return null
  }

  return {
    tabId,
    method: method.slice(0, 20).toUpperCase(),
    url,
    status: Math.floor(status),
    responseBody: responseBody.slice(0, MAX_NETWORK_BODY_LENGTH),
    timestamp: Math.floor(timestamp),
  }
}

export function createNetworkBodyMatcher() {
  const pendingBySession = new Map<string, NetworkBody[]>()

  const attach = (
    session: StoredDebuggerSession,
    body: NetworkBody
  ): boolean => {
    const request = session.events.find(
      (event): event is Extract<DebuggerEvent, { kind: "network" }> =>
        event.kind === "network" &&
        event.responseBody === undefined &&
        event.tabId === body.tabId &&
        event.method === body.method &&
        event.status === body.status &&
        withoutHash(event.url) === withoutHash(body.url) &&
        event.timestamp <= body.timestamp + 1000 &&
        body.timestamp - event.timestamp <= MATCH_WINDOW_MS
    )
    if (!request) {
      return false
    }

    request.responseBody = body.responseBody
    return true
  }

  return {
    // Returns true when the session changed.
    add(session: StoredDebuggerSession, body: NetworkBody): boolean {
      if (attach(session, body)) {
        return true
      }

      const pending = pendingBySession.get(session.sessionId) ?? []
      pending.push(body)
      pendingBySession.set(session.sessionId, pending)
      return false
    },

    // Call after new network events land in the session.
    drain(session: StoredDebuggerSession): boolean {
      const pending = pendingBySession.get(session.sessionId)
      if (!pending) {
        return false
      }

      const now = Date.now()
      let changed = false
      const stillPending = pending.filter((body) => {
        if (attach(session, body)) {
          changed = true
          return false
        }
        return now - body.timestamp <= PENDING_TTL_MS
      })

      if (stillPending.length > 0) {
        pendingBySession.set(session.sessionId, stillPending)
      } else {
        pendingBySession.delete(session.sessionId)
      }
      return changed
    },

    forget(sessionId: string): void {
      pendingBySession.delete(sessionId)
    },
  }
}

function withoutHash(url: string): string {
  const hashIndex = url.indexOf("#")
  return hashIndex === -1 ? url : url.slice(0, hashIndex)
}
