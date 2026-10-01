import { describe, expect, it } from "bun:test"

import {
  normalizeDebuggerEvent,
  normalizeStoredReplayBuffer,
  normalizeStoredSession,
} from "../src/debugger/normalize"

describe("debugger normalization regression", () => {
  it("sanitizes network events and strips debugger and sensitive headers", () => {
    const event = normalizeDebuggerEvent({
      kind: "network",
      timestamp: 1234.9,
      method: " POST ",
      url: " https://example.com/api/report ",
      status: 201.8,
      duration: 456.9,
      requestHeaders: {
        Authorization: "Bearer token",
        Cookie: "sid=abc",
        "X-Debugger-Trace": "remove-me",
        "X-Request-Id": "keep-me",
      },
      responseHeaders: {
        "Content-Type": "application/json",
        "Set-Cookie": "sid=xyz",
      },
      requestBody: "x".repeat(5000),
      responseBody: "y".repeat(5000),
    })

    expect(event).toEqual({
      kind: "network",
      timestamp: 1234,
      method: "POST",
      url: "https://example.com/api/report",
      status: 201,
      duration: 456,
      requestHeaders: {
        "x-request-id": "keep-me",
      },
      responseHeaders: {
        "content-type": "application/json",
      },
      requestBody: "x".repeat(4000),
      responseBody: "y".repeat(4000),
    })
  })

  it("drops invalid events and sanitizes stored sessions recursively", () => {
    const session = normalizeStoredSession({
      sessionId: " session_1 ",
      captureTabId: 42.9,
      captureType: "video",
      startedAt: 1000.6,
      recordingStartedAt: 1500.4,
      events: [
        {
          kind: "action",
          timestamp: 1100.8,
          actionType: "click",
          target: "button.submit",
          metadata: {
            nested: {
              ok: true,
              tooDeep: {
                keep: {
                  butDropThisLevel: {
                    evenDeeper: {
                      value: "nope",
                    },
                  },
                },
              },
            },
          },
        },
        {
          kind: "console",
          timestamp: 1200,
          level: "warn",
          message: " warn message ",
        },
        {
          kind: "wat",
          timestamp: 1300,
        },
      ],
    })

    expect(session).toEqual({
      sessionId: "session_1",
      captureTabId: 42,
      captureType: "video",
      startedAt: 1000,
      recordingStartedAt: 1500,
      recordingStoppedAt: null,
      // Older stored sessions never follow tabs.
      followTabs: false,
      recorderTabId: null,
      activeTabId: null,
      lastSwitchTabId: null,
      // Sessions stored before multi-tab capture fall back to the capture tab.
      tabs: [{ tabId: 42, joinedAt: 1000 }],
      events: [
        {
          kind: "action",
          timestamp: 1100,
          actionType: "click",
          target: "button.submit",
          metadata: {
            nested: {
              ok: true,
              tooDeep: {
                keep: {
                  butDropThisLevel: {},
                },
              },
            },
          },
        },
        {
          kind: "console",
          timestamp: 1200,
          level: "warn",
          message: "warn message",
          metadata: undefined,
        },
      ],
    })
  })

  it("keeps tab context on events and stored session tabs", () => {
    expect(
      normalizeDebuggerEvent({
        kind: "console",
        timestamp: 1000,
        level: "log",
        message: "hello",
        tabId: 7.8,
        pageUrl: " https://example.com/app ",
      })
    ).toEqual({
      kind: "console",
      timestamp: 1000,
      level: "log",
      message: "hello",
      metadata: undefined,
      tabId: 7,
      pageUrl: "https://example.com/app",
    })

    expect(
      normalizeDebuggerEvent({
        kind: "console",
        timestamp: 1000,
        level: "log",
        message: "hello",
        tabId: -1,
      })
    ).not.toHaveProperty("tabId")

    const session = normalizeStoredSession({
      sessionId: "session_2",
      captureTabId: 1,
      captureType: "video",
      startedAt: 1000,
      recordingStartedAt: null,
      recorderTabId: 9,
      tabs: [
        { tabId: 1, url: "https://example.com", title: "App", joinedAt: 1000 },
        { tabId: 2, url: "https://accounts.example.com", joinedAt: 1500 },
        { tabId: "bad", joinedAt: 1600 },
      ],
      events: [],
    })

    expect(session?.recorderTabId).toBe(9)
    expect(session?.followTabs).toBe(false)
    expect(session?.tabs).toEqual([
      { tabId: 1, url: "https://example.com", title: "App", joinedAt: 1000 },
      {
        tabId: 2,
        url: "https://accounts.example.com",
        title: undefined,
        joinedAt: 1500,
      },
    ])
  })

  it("keeps why a network request failed", () => {
    expect(
      normalizeDebuggerEvent({
        kind: "network",
        timestamp: 1000,
        method: "GET",
        url: "https://api.example.com/data",
        status: 0,
        failure: "Likely CORS error",
      })
    ).toMatchObject({ status: 0, failure: "Likely CORS error" })
  })

  it("normalizes replay buffers and rejects invalid storage data", () => {
    expect(
      normalizeStoredReplayBuffer({
        tabId: 7.9,
        lastTouchedAt: 999.4,
        events: [
          {
            kind: "console",
            timestamp: 1000.3,
            level: "info",
            message: " buffered ",
          },
          {
            kind: "network",
            timestamp: "bad",
          },
        ],
      })
    ).toEqual({
      tabId: 7,
      lastTouchedAt: 999,
      events: [
        {
          kind: "console",
          timestamp: 1000,
          level: "info",
          message: "buffered",
          metadata: undefined,
        },
      ],
    })

    expect(
      normalizeStoredSession({
        sessionId: "session_2",
        captureTabId: "bad",
        captureType: "video",
        startedAt: 1,
      })
    ).toBeNull()
  })
})
