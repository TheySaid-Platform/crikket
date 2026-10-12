import { beforeEach, describe, expect, it } from "bun:test"
import type { DebuggerSessionSnapshot } from "@crikket/capture-core/debugger/types"
import { createDebuggerSessionStore } from "./session-store"

// Just enough of the chrome API for the session store.
const openTabs = new Map<number, chrome.tabs.Tab>()

function pick(area: Record<string, unknown>, keys: string | string[]) {
  const result: Record<string, unknown> = {}
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    if (key in area) result[key] = area[key]
  }
  return Promise.resolve(result)
}

function fakeStorageArea() {
  const area: Record<string, unknown> = {}
  return {
    get: (keys: string | string[]) => pick(area, keys),
    set: (items: Record<string, unknown>) => {
      Object.assign(area, items)
      return Promise.resolve()
    },
  }
}

function installFakeChrome() {
  openTabs.clear()
  Object.assign(globalThis, {
    chrome: {
      runtime: { getURL: (path: string) => `chrome-extension://test${path}` },
      storage: { local: fakeStorageArea(), session: fakeStorageArea() },
      tabs: {
        query: () => Promise.resolve([...openTabs.values()]),
        get: (tabId: number) => {
          const tab = openTabs.get(tabId)
          return tab
            ? Promise.resolve(tab)
            : Promise.reject(new Error("No tab"))
        },
        sendMessage: () => Promise.resolve(),
      },
      scripting: { executeScript: () => Promise.resolve([]) },
    },
  })
}

function openTab(id: number, url: string, title: string): chrome.tabs.Tab {
  const tab = {
    id,
    url,
    title,
    active: true,
    incognito: false,
  } as chrome.tabs.Tab
  openTabs.set(id, tab)
  return tab
}

const logAt = (timestamp: number, message: string) => ({
  kind: "console",
  timestamp,
  level: "log",
  message,
})

async function startFullScreenRecording() {
  const store = createDebuggerSessionStore()
  openTab(1, "https://app.example.com/start", "App")
  const { sessionId } = await store.startSession({
    captureTabId: 1,
    captureType: "video",
    followTabs: true,
  })
  await store.markSessionBackgroundRecorder(sessionId)
  await store.markSessionRecordingStarted({
    sessionId,
    recordingStartedAt: Date.now(),
  })
  return { store, sessionId }
}

const messagesOf = (snapshot: DebuggerSessionSnapshot | null) =>
  (snapshot?.events ?? []).flatMap((event) =>
    event.kind === "console" ? [event.message] : []
  )

describe("debugger session store", () => {
  beforeEach(installFakeChrome)

  it("stores no events after Stop", async () => {
    const { store, sessionId } = await startFullScreenRecording()
    const now = Date.now()
    await store.appendPageEvents(1, [logAt(now, "before stop")])
    await store.markSessionRecordingStopped({
      sessionId,
      recordingStoppedAt: now + 10,
    })
    await store.appendPageEvents(1, [logAt(now + 1000, "after stop")])

    expect(messagesOf(await store.getSessionSnapshot(sessionId))).toEqual([
      "before stop",
    ])
  })

  it("stores no events while paused, and stores them again after resume", async () => {
    const { store, sessionId } = await startFullScreenRecording()
    const now = Date.now()
    await store.setSessionRecordingPaused({ sessionId, pausedAt: now })
    await store.appendPageEvents(1, [logAt(now + 500, "while paused")])
    await store.setSessionRecordingPaused({ sessionId, pausedAt: null })
    await store.appendPageEvents(1, [logAt(now + 1000, "after resume")])

    expect(messagesOf(await store.getSessionSnapshot(sessionId))).toEqual([
      "after resume",
    ])
  })

  it("lets no tab join while paused; the tab in front joins on resume", async () => {
    const { store, sessionId } = await startFullScreenRecording()
    await store.setSessionRecordingPaused({ sessionId, pausedAt: Date.now() })

    const other = openTab(2, "https://mail.example.com/inbox", "Inbox")
    await store.handleTabActivated(other)
    await store.handleTabUpdated(other)
    const opened = {
      ...openTab(3, "https://docs.example.com/", "Docs"),
      openerTabId: 1,
    }
    await store.handleTabCreated(opened)
    const whilePaused = await store.getSessionSnapshot(sessionId)
    expect(whilePaused?.tabs.map((tab) => tab.tabId)).toEqual([1])

    await store.setSessionRecordingPaused({ sessionId, pausedAt: null })
    const afterResume = await store.getSessionSnapshot(sessionId)
    expect(afterResume?.tabs.map((tab) => tab.tabId)).toEqual([1, 2])
  })

  it("keeps the captured page's title and URL after Stop", async () => {
    const store = createDebuggerSessionStore()
    openTab(1, "https://app.example.com/orders", "Orders")
    const { sessionId } = await store.startSession({
      captureTabId: 1,
      captureType: "screenshot",
    })
    await store.markSessionRecordingStopped({
      sessionId,
      recordingStoppedAt: Date.now(),
    })

    await store.handleTabUpdated(
      openTab(1, "https://mail.example.com/inbox", "Inbox")
    )

    const snapshot = await store.getSessionSnapshot(sessionId)
    expect(snapshot?.tabs[0]?.title).toBe("Orders")
    expect(snapshot?.tabs[0]?.url).toContain("app.example.com")
  })
})
