import { DEBUGGER_SESSIONS_STORAGE_KEY } from "@crikket/capture-core/debugger/constants"
import {
  appendActionEventWithDedup,
  appendEventWithRetentionPolicy,
  appendNetworkEventWithDedup,
} from "@crikket/capture-core/debugger/engine/background/retention"
import {
  normalizeDebuggerEvent,
  normalizeStoredSession,
} from "@crikket/capture-core/debugger/normalize"
import { readDebuggerSessionIdFromSearch } from "@crikket/capture-core/debugger/recorder-session"
import type {
  DebuggerEvent,
  DebuggerSessionSnapshot,
  StoredDebuggerSession,
} from "@crikket/capture-core/debugger/types"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import {
  createSessionId,
  injectDebuggerScriptIntoTab,
  isInjectablePageUrl,
} from "./injection"

const RECORDER_PAGE_PATH = "/recorder.html"
const TAB_SWITCH_ACTION_TYPE = "tab-switch"
// A video session only pulls in other tabs once its recorder page is open,
// except right after it starts (the countdown), so an orphaned session never
// keeps absorbing tabs.
const UNATTACHED_SESSION_JOIN_WINDOW_MS = 60_000

// Stamped on every event, so keep it short and drop query strings and hashes,
// which can hold tokens (e.g. OAuth callbacks).
function toPageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined

  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return undefined
  }
}

// What we keep about a tab: web pages only, no query string, and no title
// when Chrome is just showing the URL as one.
function describeTab(tab: { url?: string; title?: string }): {
  url?: string
  title?: string
} {
  const url =
    tab.url && isInjectablePageUrl(tab.url) ? toPageUrl(tab.url) : undefined
  const title = tab.title?.trim()
  const isUrlAsTitle = Boolean(
    title && tab.url && (tab.url === title || tab.url.includes(`//${title}`))
  )

  return { url, title: title && !isUrlAsTitle ? title : undefined }
}

interface StartSessionPayload {
  captureTabId: number
  captureType: "video" | "screenshot"
  instantReplayLookbackMs?: number
}

interface MarkRecordingStartedPayload {
  sessionId: string
  recordingStartedAt: number
}

interface DebuggerSessionStore {
  injectDebuggerScriptForTab: (tabId: number) => Promise<void>
  startSession: (payload: StartSessionPayload) => Promise<{
    sessionId: string
    startedAt: number
  }>
  appendPageEvents: (
    tabId: number,
    rawEvents: unknown[],
    pageUrl?: string
  ) => Promise<void>
  getSessionSnapshot: (
    sessionId: string
  ) => Promise<DebuggerSessionSnapshot | null>
  markSessionRecordingStarted: (
    payload: MarkRecordingStartedPayload
  ) => Promise<void>
  discardSession: (sessionId: string) => Promise<void>
  ensureDebuggerScriptForTab: (tabId: number, url?: string) => Promise<void>
  handleTabActivated: (tab: chrome.tabs.Tab) => Promise<void>
  handleTabCreated: (tab: chrome.tabs.Tab) => Promise<void>
  handleTabUpdated: (tab: chrome.tabs.Tab) => Promise<void>
  handleTabRemoved: (tabId: number) => Promise<void>
}

export function createDebuggerSessionStore(): DebuggerSessionStore {
  const sessionsById = new Map<string, StoredDebuggerSession>()
  const tabToSession = new Map<number, string>()
  const recentEventsByTab = new Map<number, DebuggerEvent[]>()
  const tabUrls = new Map<number, string>()
  // The tab the user is on, and the tab the last tab-switch event pointed at.
  // They differ while a just-opened tab has no URL yet.
  const activeTabBySession = new Map<string, number>()
  const lastSwitchTabBySession = new Map<string, number>()

  let isLoaded = false
  let loadPromise: Promise<void> | null = null
  let persistTimer: ReturnType<typeof setTimeout> | null = null

  const schedulePersist = () => {
    if (persistTimer) {
      return
    }

    persistTimer = setTimeout(() => {
      persistTimer = null
      persistState().catch((error: unknown) => {
        reportNonFatalError("Failed to persist debugger state", error)
      })
    }, 250)
  }

  const persistState = async () => {
    const sessionsSnapshot = Array.from(sessionsById.values())

    await chrome.storage.local.set({
      [DEBUGGER_SESSIONS_STORAGE_KEY]: sessionsSnapshot,
    })
  }

  // Fills tabUrls (lost when the worker restarts) and returns the open tab ids.
  const loadOpenTabs = async (): Promise<Set<number>> => {
    const openTabs = await chrome.tabs.query({}).catch((error: unknown) => {
      reportNonFatalError("Failed to list tabs while loading state", error)
      return [] as chrome.tabs.Tab[]
    })

    const openTabIds = new Set<number>()
    for (const tab of openTabs) {
      if (typeof tab.id !== "number") continue
      openTabIds.add(tab.id)
      if (tab.url && isInjectablePageUrl(tab.url)) {
        tabUrls.set(tab.id, tab.url)
      }
    }

    return openTabIds
  }

  const hydrateStoredState = async () => {
    const [result, openTabIds] = await Promise.all([
      chrome.storage.local.get([DEBUGGER_SESSIONS_STORAGE_KEY]),
      loadOpenTabs(),
    ])

    const storedSessions = result[DEBUGGER_SESSIONS_STORAGE_KEY]

    if (!Array.isArray(storedSessions)) {
      return
    }

    for (const candidate of storedSessions) {
      const session = normalizeStoredSession(candidate)
      if (!session) {
        continue
      }

      sessionsById.set(session.sessionId, session)
      for (const tab of session.tabs) {
        if (openTabIds.size === 0 || openTabIds.has(tab.tabId)) {
          tabToSession.set(tab.tabId, session.sessionId)
        }
      }
    }
  }

  const ensureLoaded = async () => {
    if (isLoaded) {
      return
    }

    if (loadPromise) {
      await loadPromise
      return
    }

    loadPromise = hydrateStoredState()
      .catch((error: unknown) => {
        reportNonFatalError("Failed to load debugger state from storage", error)
      })
      .finally(() => {
        isLoaded = true
        loadPromise = null
      })

    await loadPromise
  }

  const removeSession = (sessionId: string) => {
    if (!sessionsById.delete(sessionId)) {
      return
    }

    activeTabBySession.delete(sessionId)
    lastSwitchTabBySession.delete(sessionId)
    for (const [tabId, mappedSessionId] of tabToSession) {
      if (mappedSessionId === sessionId) {
        tabToSession.delete(tabId)
      }
    }
  }

  const appendEventsToSession = (
    session: StoredDebuggerSession,
    events: DebuggerEvent[]
  ): void => {
    if (events.length === 0) {
      return
    }

    for (const event of events) {
      if (event.kind === "network") {
        appendNetworkEventWithDedup(session.events, event)
      } else if (event.kind === "action") {
        appendActionEventWithDedup(session.events, event)
      } else {
        appendEventWithRetentionPolicy(session.events, event)
      }
    }

    schedulePersist()
  }

  const appendEventsToRecentBuffer = (
    tabId: number,
    events: DebuggerEvent[]
  ): void => {
    if (events.length === 0) {
      return
    }

    const now = Date.now()
    const MAX_RECENT_EVENT_AGE_MS = 60_000
    const MAX_RECENT_EVENT_COUNT = 250
    const existing = recentEventsByTab.get(tabId) ?? []

    const merged = [...existing, ...events].filter((event) => {
      return now - event.timestamp <= MAX_RECENT_EVENT_AGE_MS
    })

    if (merged.length > MAX_RECENT_EVENT_COUNT) {
      recentEventsByTab.set(
        tabId,
        merged.slice(merged.length - MAX_RECENT_EVENT_COUNT)
      )
      return
    }

    recentEventsByTab.set(tabId, merged)
  }

  const consumeInstantReplayEvents = (
    tabId: number,
    lookbackMs: number
  ): DebuggerEvent[] => {
    const now = Date.now()
    const recentEvents = recentEventsByTab.get(tabId) ?? []
    if (recentEvents.length === 0) {
      return []
    }

    return recentEvents.filter((event) => {
      return now - event.timestamp <= lookbackMs
    })
  }

  // The newest video session that can still take in more tabs.
  const getJoinableSession = (): StoredDebuggerSession | null => {
    let newest: StoredDebuggerSession | null = null

    for (const session of sessionsById.values()) {
      if (session.captureType !== "video") continue
      if (!newest || session.startedAt > newest.startedAt) {
        newest = session
      }
    }

    if (!newest) {
      return null
    }

    const isAttached = newest.recorderTabId !== null
    const isStarting =
      Date.now() - newest.startedAt <= UNATTACHED_SESSION_JOIN_WINDOW_MS

    return isAttached || isStarting ? newest : null
  }

  const updateSessionTabInfo = (
    session: StoredDebuggerSession,
    tab: chrome.tabs.Tab
  ): void => {
    const sessionTab = session.tabs.find((entry) => entry.tabId === tab.id)
    if (!sessionTab) {
      return
    }

    const { url, title } = describeTab(tab)
    if (url) {
      sessionTab.url = url
    }
    if (title) {
      sessionTab.title = title
    }
    schedulePersist()
  }

  // Adds a tab to the session and pulls in what it logged since the session
  // started, so requests fired before the tab joined are not lost.
  const trackTab = async (
    session: StoredDebuggerSession,
    tab: chrome.tabs.Tab
  ): Promise<void> => {
    const tabId = tab.id
    if (typeof tabId !== "number") {
      return
    }

    if (tabToSession.get(tabId) === session.sessionId) {
      updateSessionTabInfo(session, tab)
      return
    }

    tabToSession.set(tabId, session.sessionId)
    if (!session.tabs.some((entry) => entry.tabId === tabId)) {
      session.tabs.push({ tabId, ...describeTab(tab), joinedAt: Date.now() })
    }

    const bufferedEvents = (recentEventsByTab.get(tabId) ?? []).filter(
      (event) => event.timestamp >= session.startedAt
    )
    appendEventsToSession(session, bufferedEvents)
    schedulePersist()

    if (tab.url && isInjectablePageUrl(tab.url)) {
      await injectDebuggerScriptIntoTab(tabId)
    }
  }

  const recordTabSwitch = (
    session: StoredDebuggerSession,
    tab: chrome.tabs.Tab
  ): void => {
    const tabId = tab.id
    if (typeof tabId !== "number") {
      return
    }

    if (lastSwitchTabBySession.get(session.sessionId) === tabId) {
      return
    }
    lastSwitchTabBySession.set(session.sessionId, tabId)

    const { url, title } = describeTab(tab)
    appendEventsToSession(session, [
      {
        kind: "action",
        timestamp: Date.now(),
        actionType: TAB_SWITCH_ACTION_TYPE,
        target: "tab",
        metadata: { url, title },
        tabId,
        pageUrl: url,
      },
    ])
  }

  const attachRecorderTab = (tab: chrome.tabs.Tab): boolean => {
    if (typeof tab.id !== "number" || !tab.url) {
      return false
    }

    const recorderPageUrl = chrome.runtime.getURL(RECORDER_PAGE_PATH)
    if (!tab.url.startsWith(recorderPageUrl)) {
      return false
    }

    const tabId = tab.id
    const sessionId = readDebuggerSessionIdFromSearch(new URL(tab.url).search)
    const session = sessionId ? sessionsById.get(sessionId) : undefined
    if (session && session.recorderTabId !== tabId) {
      session.recorderTabId = tabId
      schedulePersist()
    }

    // The recorder tab can be picked up as a session tab while it is still
    // about:blank; it is never one.
    const trackedSession = sessionsById.get(tabToSession.get(tabId) ?? "")
    if (trackedSession) {
      tabToSession.delete(tabId)
      trackedSession.tabs = trackedSession.tabs.filter(
        (entry) => entry.tabId !== tabId
      )
      schedulePersist()
    }

    return true
  }

  const startSession = async (payload: StartSessionPayload) => {
    await ensureLoaded()

    const startedAt = Date.now()
    const sessionId = createSessionId()
    const instantReplayLookbackMs =
      typeof payload.instantReplayLookbackMs === "number" &&
      Number.isFinite(payload.instantReplayLookbackMs) &&
      payload.instantReplayLookbackMs > 0
        ? Math.floor(payload.instantReplayLookbackMs)
        : 0
    const instantReplayEvents =
      instantReplayLookbackMs > 0
        ? consumeInstantReplayEvents(
            payload.captureTabId,
            instantReplayLookbackMs
          )
        : []
    const captureTab = await chrome.tabs
      .get(payload.captureTabId)
      .catch(() => null)
    const captureTabInfo = describeTab({
      url: captureTab?.url ?? tabUrls.get(payload.captureTabId),
      title: captureTab?.title,
    })

    const session: StoredDebuggerSession = {
      sessionId,
      captureTabId: payload.captureTabId,
      captureType: payload.captureType,
      startedAt,
      recordingStartedAt:
        payload.captureType === "screenshot" ? startedAt : null,
      recorderTabId: null,
      tabs: [
        { tabId: payload.captureTabId, ...captureTabInfo, joinedAt: startedAt },
      ],
      events: instantReplayEvents,
    }

    sessionsById.set(sessionId, session)
    tabToSession.set(payload.captureTabId, sessionId)
    activeTabBySession.set(sessionId, payload.captureTabId)
    lastSwitchTabBySession.set(sessionId, payload.captureTabId)
    schedulePersist()
    await injectDebuggerScriptIntoTab(payload.captureTabId)

    return {
      sessionId,
      startedAt,
    }
  }

  const injectDebuggerScriptForTab = async (tabId: number): Promise<void> => {
    await ensureLoaded()

    if (!tabToSession.has(tabId)) {
      return
    }

    await injectDebuggerScriptIntoTab(tabId)
  }

  const appendPageEvents = async (
    tabId: number,
    rawEvents: unknown[],
    pageUrl?: string
  ) => {
    await ensureLoaded()

    if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
      return
    }

    if (pageUrl && isInjectablePageUrl(pageUrl)) {
      tabUrls.set(tabId, pageUrl)
    }
    const resolvedPageUrl = toPageUrl(tabUrls.get(tabId))

    const normalizedEvents: DebuggerEvent[] = []
    for (const rawEvent of rawEvents) {
      const normalizedEvent = normalizeDebuggerEvent(rawEvent)
      if (!normalizedEvent) {
        continue
      }

      // Tab context comes from the browser, never from the page.
      normalizedEvent.tabId = tabId
      normalizedEvent.pageUrl = resolvedPageUrl
      normalizedEvents.push(normalizedEvent)
    }

    appendEventsToRecentBuffer(tabId, normalizedEvents)

    const sessionId = tabToSession.get(tabId)
    const session = sessionId ? sessionsById.get(sessionId) : undefined
    if (session) {
      appendEventsToSession(session, normalizedEvents)
    }
  }

  const getSessionSnapshot = async (
    sessionId: string
  ): Promise<DebuggerSessionSnapshot | null> => {
    await ensureLoaded()

    const session = sessionsById.get(sessionId)
    if (!session) {
      return null
    }

    return {
      sessionId: session.sessionId,
      captureTabId: session.captureTabId,
      captureType: session.captureType,
      startedAt: session.startedAt,
      recordingStartedAt: session.recordingStartedAt,
      tabs: session.tabs,
      events: session.events,
    }
  }

  const markSessionRecordingStarted = async (
    payload: MarkRecordingStartedPayload
  ) => {
    await ensureLoaded()

    const session = sessionsById.get(payload.sessionId)
    if (!session) {
      return
    }

    session.recordingStartedAt = Math.floor(payload.recordingStartedAt)
    schedulePersist()
  }

  const discardSession = async (sessionId: string) => {
    await ensureLoaded()

    const session = sessionsById.get(sessionId)
    removeSession(sessionId)
    if (session) {
      recentEventsByTab.delete(session.captureTabId)
    }
    schedulePersist()
  }

  const ensureDebuggerScriptForTab = async (
    tabId: number,
    url?: string
  ): Promise<void> => {
    await ensureLoaded()

    if (!(url && isInjectablePageUrl(url))) {
      return
    }

    if (!tabToSession.has(tabId)) {
      return
    }

    await injectDebuggerScriptIntoTab(tabId)
  }

  const isTrackableTab = (tab: chrome.tabs.Tab): boolean => {
    return (
      typeof tab.id === "number" &&
      !tab.incognito &&
      typeof tab.url === "string" &&
      isInjectablePageUrl(tab.url)
    )
  }

  const handleTabActivated = async (tab: chrome.tabs.Tab): Promise<void> => {
    await ensureLoaded()

    const session = getJoinableSession()
    if (!session || typeof tab.id !== "number") {
      return
    }

    activeTabBySession.set(session.sessionId, tab.id)
    // A tab opened from a link is active before it has a URL; handleTabUpdated
    // records the switch once it does.
    if (!isTrackableTab(tab)) {
      return
    }

    await trackTab(session, tab)
    recordTabSwitch(session, tab)
  }

  // Tabs opened from a session tab (target=_blank links, OAuth popups) join
  // even before the user looks at them.
  const handleTabCreated = async (tab: chrome.tabs.Tab): Promise<void> => {
    await ensureLoaded()

    const session = getJoinableSession()
    if (!session || tab.incognito || typeof tab.openerTabId !== "number") {
      return
    }

    const url = tab.pendingUrl || tab.url
    if (url && !isInjectablePageUrl(url) && url !== "about:blank") {
      return
    }

    if (tabToSession.get(tab.openerTabId) !== session.sessionId) {
      return
    }

    await trackTab(session, tab)
  }

  const handleTabUpdated = async (tab: chrome.tabs.Tab): Promise<void> => {
    await ensureLoaded()

    if (typeof tab.id !== "number" || attachRecorderTab(tab)) {
      return
    }

    if (tab.url && isInjectablePageUrl(tab.url)) {
      tabUrls.set(tab.id, tab.url)
    }

    const trackedSession = sessionsById.get(tabToSession.get(tab.id) ?? "")
    if (trackedSession) {
      updateSessionTabInfo(trackedSession, tab)
    }

    // The tab the user is on only now became a web page: a link opened in a
    // new tab, or a new tab where they typed a URL.
    const session = getJoinableSession()
    if (
      !session ||
      activeTabBySession.get(session.sessionId) !== tab.id ||
      !isTrackableTab(tab)
    ) {
      return
    }

    await trackTab(session, tab)
    recordTabSwitch(session, tab)
  }

  const handleTabRemoved = async (tabId: number): Promise<void> => {
    await ensureLoaded()

    tabUrls.delete(tabId)
    recentEventsByTab.delete(tabId)

    for (const session of Array.from(sessionsById.values())) {
      if (session.recorderTabId === tabId) {
        removeSession(session.sessionId)
      }
    }

    const sessionId = tabToSession.get(tabId)
    tabToSession.delete(tabId)

    const session = sessionId ? sessionsById.get(sessionId) : undefined
    if (session) {
      const hasOpenTabs = Array.from(tabToSession.values()).includes(
        session.sessionId
      )
      // Without a recorder page, nothing is left to submit the session.
      if (!hasOpenTabs && session.recorderTabId === null) {
        removeSession(session.sessionId)
      }
    }

    schedulePersist()
  }

  return {
    injectDebuggerScriptForTab,
    startSession,
    appendPageEvents,
    getSessionSnapshot,
    markSessionRecordingStarted,
    discardSession,
    ensureDebuggerScriptForTab,
    handleTabActivated,
    handleTabCreated,
    handleTabUpdated,
    handleTabRemoved,
  }
}
