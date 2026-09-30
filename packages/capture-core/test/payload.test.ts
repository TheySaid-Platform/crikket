import { describe, expect, it } from "bun:test"

import {
  buildDebuggerSubmissionPayload,
  hasDebuggerPayloadData,
} from "../src/debugger/payload"
import type { DebuggerSessionSnapshot } from "../src/debugger/types"

describe("debugger payload regression", () => {
  it("sorts events and computes offsets from recording start when available", () => {
    const snapshot: DebuggerSessionSnapshot = {
      sessionId: "session_1",
      captureTabId: 12,
      captureType: "video",
      startedAt: 1000,
      recordingStartedAt: 1500,
      tabs: [{ tabId: 12, joinedAt: 1000 }],
      events: [
        {
          kind: "network",
          timestamp: 2100,
          method: "POST",
          url: "https://example.com/api/report",
          status: 201,
        },
        {
          kind: "action",
          timestamp: 1200,
          actionType: "click",
          target: "button.submit",
          metadata: {
            source: "checkout",
          },
        },
        {
          kind: "console",
          timestamp: 1800,
          level: "error",
          message: "Network failed",
          metadata: {
            attempts: 2,
          },
        },
      ],
    }

    const payload = buildDebuggerSubmissionPayload(snapshot)

    expect(payload).toEqual({
      actions: [
        {
          type: "click",
          target: "button.submit",
          timestamp: new Date(1200).toISOString(),
          offset: null,
          metadata: {
            source: "checkout",
          },
        },
      ],
      logs: [
        {
          level: "error",
          message: "Network failed",
          timestamp: new Date(1800).toISOString(),
          offset: 300,
          metadata: {
            attempts: 2,
          },
        },
      ],
      networkRequests: [
        {
          method: "POST",
          url: "https://example.com/api/report",
          status: 201,
          duration: undefined,
          requestHeaders: undefined,
          responseHeaders: undefined,
          requestBody: undefined,
          responseBody: undefined,
          timestamp: new Date(2100).toISOString(),
          offset: 600,
        },
      ],
    })
  })

  it("carries the source tab of each event into the payload", () => {
    const payload = buildDebuggerSubmissionPayload({
      sessionId: "session_2",
      captureTabId: 1,
      captureType: "video",
      startedAt: 1000,
      recordingStartedAt: 1000,
      tabs: [
        { tabId: 1, joinedAt: 1000 },
        { tabId: 2, joinedAt: 1100 },
      ],
      events: [
        {
          kind: "network",
          timestamp: 1200,
          method: "GET",
          url: "https://accounts.example.com/token",
          status: 200,
          tabId: 2,
          pageUrl: "https://accounts.example.com/login",
        },
        {
          kind: "console",
          timestamp: 1300,
          level: "log",
          message: "back in app",
          tabId: 1,
          pageUrl: "https://example.com/app",
        },
      ],
    })

    expect(payload.networkRequests[0]).toMatchObject({
      tabId: 2,
      pageUrl: "https://accounts.example.com/login",
    })
    expect(payload.logs[0]).toMatchObject({
      tabId: 1,
      pageUrl: "https://example.com/app",
    })
  })

  it("detects whether a payload contains any debugger data", () => {
    expect(
      hasDebuggerPayloadData({
        actions: [],
        logs: [],
        networkRequests: [],
      })
    ).toBe(false)

    expect(
      hasDebuggerPayloadData({
        actions: [
          {
            type: "click",
            timestamp: new Date(1000).toISOString(),
            offset: 0,
          },
        ],
        logs: [],
        networkRequests: [],
      })
    ).toBe(true)
  })
})
