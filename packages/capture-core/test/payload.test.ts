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

  it("leaves out what happened after the recording stopped", () => {
    const payload = buildDebuggerSubmissionPayload({
      sessionId: "session_3",
      captureTabId: 1,
      captureType: "video",
      startedAt: 1000,
      recordingStartedAt: 1000,
      recordingStoppedAt: 5000,
      tabs: [{ tabId: 1, joinedAt: 1000 }],
      events: [
        { kind: "console", timestamp: 4000, level: "log", message: "during" },
        { kind: "console", timestamp: 5000, level: "log", message: "at stop" },
        {
          kind: "console",
          timestamp: 6000,
          level: "log",
          message: "filling in the form",
        },
      ],
    })

    expect(payload.logs.map((log) => log.message)).toEqual([
      "during",
      "at stop",
    ])
  })

  it("leaves out paused time and lines later events up with the video", () => {
    const payload = buildDebuggerSubmissionPayload(
      {
        sessionId: "session_4",
        captureTabId: 1,
        captureType: "video",
        startedAt: 1000,
        recordingStartedAt: 1000,
        tabs: [{ tabId: 1, joinedAt: 1000 }],
        events: [
          { kind: "console", timestamp: 1500, level: "log", message: "before" },
          { kind: "console", timestamp: 2500, level: "log", message: "paused" },
          { kind: "console", timestamp: 3500, level: "log", message: "after" },
          {
            kind: "console",
            timestamp: 5500,
            level: "log",
            message: "paused again",
          },
          { kind: "console", timestamp: 7000, level: "log", message: "last" },
        ],
      },
      [
        { pausedAt: 2000, resumedAt: 3000 },
        { pausedAt: 5000, resumedAt: 6000 },
      ]
    )

    expect(
      payload.logs.map((log) => [log.message, log.offset] as const)
    ).toEqual([
      ["before", 500],
      ["after", 1500],
      ["last", 4000],
    ])
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
