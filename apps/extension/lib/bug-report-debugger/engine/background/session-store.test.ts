import { beforeEach, describe, expect, it } from "bun:test"

// The parts of the chrome API the session store uses, in memory.
function createStorageArea() {
  const data: Record<string, unknown> = {}
  return {
    get: (keys: string | string[]) => {
      const result: Record<string, unknown> = {}
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (key in data) result[key] = data[key]
      }
      return Promise.resolve(result)
    },
    set: (items: Record<string, unknown>) => {
      Object.assign(data, items)
      return Promise.resolve()
    },
    remove: () => Promise.resolve(),
  }
}

Object.assign(globalThis, {
  chrome: {
    storage: { local: createStorageArea(), session: createStorageArea() },
    tabs: {
      get: (tabId: number) =>
        Promise.resolve({
          id: tabId,
          url: "https://shop.example/",
          title: "Shop",
        }),
      query: () => Promise.resolve([]),
      sendMessage: () => Promise.resolve(),
    },
    runtime: { getURL: (path: string) => `chrome-extension://test${path}` },
  },
})

const { createDebuggerSessionStore } = await import("./session-store")
type Store = ReturnType<typeof createDebuggerSessionStore>

const TAB_ID = 7
const log = (message: string, agoMs: number) => ({
  kind: "console",
  level: "log",
  message,
  timestamp: Date.now() - agoMs,
})

async function messagesOf(
  store: Store,
  captureType: "video" | "screenshot",
  lookbackMs: number
): Promise<string[]> {
  const { sessionId } = await store.startSession({
    captureTabId: TAB_ID,
    captureType,
    instantReplayLookbackMs: lookbackMs,
  })
  const snapshot = await store.getSessionSnapshot(sessionId)
  return (snapshot?.events ?? []).map((event) =>
    event.kind === "console" ? event.message : event.kind
  )
}

describe("recent events of a tab", () => {
  let store: Store

  beforeEach(() => {
    store = createDebuggerSessionStore()
  })

  it("starts the next screenshot after the last one, but keeps the events for a replay", async () => {
    store.setInstantReplayEnabled(true)
    await store.appendPageEvents(TAB_ID, [log("before", 5000)])

    const first = await store.startSession({
      captureTabId: TAB_ID,
      captureType: "screenshot",
      instantReplayLookbackMs: 10_000,
    })
    expect(
      (await store.getSessionSnapshot(first.sessionId))?.events
    ).toHaveLength(1)
    await store.discardSession(first.sessionId)

    await store.appendPageEvents(TAB_ID, [log("after", 0)])
    expect(await messagesOf(store, "screenshot", 10_000)).toEqual(["after"])
    expect(await messagesOf(store, "video", 60_000)).toEqual([
      "before",
      "after",
    ])
  })

  it("keeps a minute while instant replay is off, and its window while it is on", async () => {
    const twoMinutes = 2 * 60_000

    store.setInstantReplayEnabled(false)
    await store.appendPageEvents(TAB_ID, [log("old while off", twoMinutes)])
    expect(await messagesOf(store, "video", 5 * 60_000)).toEqual([])

    store.setInstantReplayEnabled(true)
    await store.appendPageEvents(TAB_ID, [log("old while on", twoMinutes)])
    expect(await messagesOf(store, "video", 5 * 60_000)).toEqual([
      "old while on",
    ])

    // Turning it off drops what is older than a minute at once.
    store.setInstantReplayEnabled(false)
    expect(await messagesOf(store, "video", 5 * 60_000)).toEqual([])
  })
})
