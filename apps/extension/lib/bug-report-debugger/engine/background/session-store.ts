import {
  CAPTURE_STATE_MESSAGE,
  DEBUGGER_SESSIONS_STORAGE_KEY,
} from "@crikket/capture-core/debugger/constants"
import {
  appendActionEventWithDedup,
  appendEventWithRetentionPolicy,
} from "@crikket/capture-core/debugger/engine/background/retention"
import {
  normalizeDebuggerEvent,
  normalizeStoredSession,
} from "@crikket/capture-core/debugger/normalize"
import { readDebuggerSessionIdFromSearch } from "@crikket/capture-core/debugger/recorder-session"
import type {
  DebuggerCaptureState,
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
import { createNetworkBodyMatcher, toNetworkBody } from "./network-bodies"

const RECORDER_PAGE_PATH = "/recorder.html"
const TAB_SWITCH_ACTION_TYPE = "tab-switch"
// A video session only pulls in other tabs once its recorder page is open,
// except right after it starts (the countdown), so an orphaned session never
// keeps absorbing tabs.
const UNATTACHED_SESSION_JOIN_WINDOW_MS = 60_000
// chrome.storage.session survives a worker restart but not a browser restart,
// so finding this marker means stored tab ids still point at the same tabs.
const BROWSER_SESSION_MARKER_KEY = "crikketDebuggerBrowserSession"

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
  followTabs?: boolean
}

interface MarkRecordingStartedPayload {
  sessionId: string
  recordingStartedAt: number
}

interface MarkRecordingStoppedPayload {
  sessionId: string
  recordingStoppedAt: number
}

interface SetRecordingPausedPayload {
  sessionId: string
  pausedAt: number | null
}

// Where a batch of page events came from: the sending page's own URL (top
// frame), and the tab's current URL.
interface PageEventSource {
  pageUrl?: string
  tabUrl?: string
}

export interface DebuggerSessionStore {
  injectDebuggerScriptForTab: (tabId: number) => Promise<void>
  startSession: (payload: StartSessionPayload) => Promise<{
    sessionId: string
    startedAt: number
  }>
  appendPageEvents: (
    tabId: number,
    rawEvents: unknown[],
    source?: PageEventSource
  ) => Promise<void>
  getSessionSnapshot: (
    sessionId: string
  ) => Promise<DebuggerSessionSnapshot | null>
  markSessionRecordingStarted: (
    payload: MarkRecordingStartedPayload
  ) => Promise<void>
  markSessionRecordingStopped: (
    payload: MarkRecordingStoppedPayload
  ) => Promise<void>
  setSessionRecordingPaused: (
    payload: SetRecordingPausedPayload
  ) => Promise<void>
  discardSession: (sessionId: string) => Promise<void>
  markSessionBackgroundRecorder: (sessionId: string) => Promise<void>
  ensureDebuggerScriptForTab: (tabId: number, url?: string) => Promise<void>
  handleTabActivated: (tab: chrome.tabs.Tab) => Promise<void>
  handleTabCreated: (tab: chrome.tabs.Tab) => Promise<void>
  handleTabUpdated: (tab: chrome.tabs.Tab) => Promise<void>
  handleTabRemoved: (tabId: number) => Promise<void>
  getCaptureState: (tabId: number) => Promise<DebuggerCaptureState>
}

export function createDebuggerSessionStore(): DebuggerSessionStore {
  const sessionsById = new Map<string, StoredDebuggerSession>()
  const tabToSession = new Map<number, string>()
  const recentEventsByTab = new Map<number, DebuggerEvent[]>()
  const tabUrls = new Map<number, string>()
  const networkBodies = createNetworkBodyMatcher()

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

  // Fills tabUrls (lost when the worker restarts) and returns the open tabs'
  // URLs by id, or null if they could not be listed.
  const loadOpenTabs = async (): Promise<Map<number, string> | null> => {
    const openTabs = await chrome.tabs.query({}).catch((error: unknown) => {
      reportNonFatalError("Failed to list tabs while loading state", error)
      return null
    })
    if (!openTabs) {
      return null
    }

    const urlsByTabId = new Map<number, string>()
    for (const tab of openTabs) {
      if (typeof tab.id !== "number") continue
      urlsByTabId.set(tab.id, tab.url ?? "")
      if (tab.url && isInjectablePageUrl(tab.url)) {
        tabUrls.set(tab.id, tab.url)
      }
    }

    return urlsByTabId
  }

  // After a browser restart, stored sessions point at tab ids Chrome may have
  // given to unrelated tabs. Keep a session only if its own recorder page is
  // still open, or it is young enough that the recorder is still opening.
  const isRecorderStillOpen = (
    session: StoredDebuggerSession,
    urlsByTabId: Map<number, string>
  ): boolean => {
    if (session.recorderTabId === null) {
      return Date.now() - session.startedAt <= UNATTACHED_SESSION_JOIN_WINDOW_MS
    }

    const url = urlsByTabId.get(session.recorderTabId)
    if (!url?.startsWith(chrome.runtime.getURL(RECORDER_PAGE_PATH))) {
      return false
    }

    return (
      readDebuggerSessionIdFromSearch(new URL(url).search) === session.sessionId
    )
  }

  const restoreSession = (
    session: StoredDebuggerSession,
    urlsByTabId: Map<number, string> | null
  ) => {
    sessionsById.set(session.sessionId, session)
    for (const tab of session.tabs) {
      if (!urlsByTabId || urlsByTabId.has(tab.tabId)) {
        tabToSession.set(tab.tabId, session.sessionId)
      }
    }
  }

  // False after a browser restart or an extension reload.
  const isSameBrowserSession = async (): Promise<boolean> => {
    try {
      const result = await chrome.storage.session.get(
        BROWSER_SESSION_MARKER_KEY
      )
      await chrome.storage.session.set({ [BROWSER_SESSION_MARKER_KEY]: true })
      return result[BROWSER_SESSION_MARKER_KEY] === true
    } catch {
      return false
    }
  }

  // Chrome restarts the worker on its own, often mid-recording: a session with
  // no recorder page survives that, until the browser restarts.
  const shouldRestoreSession = (
    session: StoredDebuggerSession,
    urlsByTabId: Map<number, string> | null,
    sameBrowserSession: boolean
  ): boolean => {
    if (session.backgroundRecorder) {
      return sameBrowserSession
    }
    return !urlsByTabId || isRecorderStillOpen(session, urlsByTabId)
  }

  const hydrateStoredState = async () => {
    const [result, urlsByTabId, sameBrowserSession] = await Promise.all([
      chrome.storage.local.get([DEBUGGER_SESSIONS_STORAGE_KEY]),
      loadOpenTabs(),
      isSameBrowserSession(),
    ])

    const storedSessions = result[DEBUGGER_SESSIONS_STORAGE_KEY]

    if (!Array.isArray(storedSessions)) {
      return
    }

    let droppedStaleSession = false
    for (const candidate of storedSessions) {
      const session = normalizeStoredSession(candidate)
      if (!session) {
        continue
      }

      if (!shouldRestoreSession(session, urlsByTabId, sameBrowserSession)) {
        droppedStaleSession = true
        continue
      }

      restoreSession(session, urlsByTabId)
    }

    if (droppedStaleSession) {
      schedulePersist()
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

  // Tells every frame in a tab whether to read response bodies. Only video
  // sessions follow the user around, so only they turn it on.
  const sendCaptureState = (tabId: number, networkBodies: boolean) => {
    chrome.tabs
      .sendMessage(tabId, { type: CAPTURE_STATE_MESSAGE, networkBodies })
      .catch(() => {
        // No content script in this tab (yet); it asks on load instead.
      })
  }

  const removeSession = (sessionId: string) => {
    if (!sessionsById.delete(sessionId)) {
      return
    }

    networkBodies.forget(sessionId)
    for (const [tabId, mappedSessionId] of tabToSession) {
      if (mappedSessionId === sessionId) {
        tabToSession.delete(tabId)
        sendCaptureState(tabId, false)
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

    // Paused time is not in the report, and neither is anything after Stop.
    // Storing them anyway could push recorded events out of the capped list.
    const pausedAt = session.recordingPausedAt
    const stoppedAt = session.recordingStoppedAt
    for (const event of events) {
      if (pausedAt !== null && event.timestamp > pausedAt) {
        continue
      }
      if (stoppedAt !== null && event.timestamp > stoppedAt) {
        continue
      }
      // Network events are not deduplicated: webRequest reports each request
      // once, so two identical ones are two real requests.
      if (event.kind === "action") {
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

  const isRecording = (session: StoredDebuggerSession): boolean =>
    session.captureType === "video" &&
    session.recordingStartedAt !== null &&
    session.recordingStoppedAt === null

  // A full screen recording follows the user and a recorded tab can close
  // mid-recording, so the session stays until Stop.
  const isBackgroundRecordingRunning = (
    session: StoredDebuggerSession
  ): boolean =>
    session.backgroundRecorder &&
    session.captureType === "video" &&
    session.recordingStoppedAt === null

  // A tab first seen while paused was never on the video, so nothing joins a
  // paused session; the tab in front joins when the recording resumes.
  const isPaused = (session: StoredDebuggerSession): boolean =>
    session.recordingPausedAt !== null

  // The newest session that follows the user into other tabs, while it is
  // recording. Record This Tab sessions never take in other tabs.
  const getJoinableSession = (): StoredDebuggerSession | null => {
    let newest: StoredDebuggerSession | null = null

    for (const session of sessionsById.values()) {
      if (session.captureType !== "video") continue
      if (!newest || session.startedAt > newest.startedAt) {
        newest = session
      }
    }

    if (
      !newest?.followTabs ||
      (newest.recorderTabId === null && !newest.backgroundRecorder) ||
      !isRecording(newest)
    ) {
      return null
    }

    return newest
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
    sendCaptureState(tabId, isRecording(session))
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

    // A switch made while paused is recorded on resume instead.
    if (
      session.lastSwitchTabId === tabId ||
      session.recordingPausedAt !== null
    ) {
      return
    }
    session.lastSwitchTabId = tabId

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
      recordingStoppedAt: null,
      recordingPausedAt: null,
      followTabs:
        payload.captureType === "video" && payload.followTabs === true,
      recorderTabId: null,
      backgroundRecorder: false,
      activeTabId: payload.captureTabId,
      lastSwitchTabId: payload.captureTabId,
      tabs: [
        { tabId: payload.captureTabId, ...captureTabInfo, joinedAt: startedAt },
      ],
      events: instantReplayEvents,
    }

    sessionsById.set(sessionId, session)
    tabToSession.set(payload.captureTabId, sessionId)
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

  const normalizePageEvents = (
    tabId: number,
    rawEvents: unknown[],
    pageUrl: string | undefined
  ): DebuggerEvent[] => {
    const resolvedPageUrl = toPageUrl(pageUrl)
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

    return normalizedEvents
  }

  // Response bodies fill in requests already recorded, not new events, so
  // pull them out and hand back everything else.
  const takeNetworkBodies = (
    tabId: number,
    rawEvents: unknown[],
    session: StoredDebuggerSession | undefined
  ): unknown[] => {
    const otherEvents: unknown[] = []

    for (const rawEvent of rawEvents) {
      const body = toNetworkBody(rawEvent, tabId)
      if (!body) {
        otherEvents.push(rawEvent)
      } else if (session && networkBodies.add(session, body)) {
        schedulePersist()
      }
    }

    return otherEvents
  }

  const appendPageEvents = async (
    tabId: number,
    rawEvents: unknown[],
    source: PageEventSource = {}
  ) => {
    await ensureLoaded()

    if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
      return
    }

    if (source.tabUrl && isInjectablePageUrl(source.tabUrl)) {
      tabUrls.set(tabId, source.tabUrl)
    }
    // Events flushed as a page unloads arrive after the tab moved on, so the
    // sending page's own URL wins over the tab's.
    const pageUrl =
      source.pageUrl && isInjectablePageUrl(source.pageUrl)
        ? source.pageUrl
        : tabUrls.get(tabId)
    const sessionId = tabToSession.get(tabId)
    const session = sessionId ? sessionsById.get(sessionId) : undefined

    const eventsToNormalize = takeNetworkBodies(tabId, rawEvents, session)
    const normalizedEvents = normalizePageEvents(
      tabId,
      eventsToNormalize,
      pageUrl
    )
    appendEventsToRecentBuffer(tabId, normalizedEvents)

    if (session && normalizedEvents.length > 0) {
      appendEventsToSession(session, normalizedEvents)
      networkBodies.drain(session)
    }
  }

  const getCaptureState = async (
    tabId: number
  ): Promise<DebuggerCaptureState> => {
    await ensureLoaded()

    const session = sessionsById.get(tabToSession.get(tabId) ?? "")
    return { networkBodies: session ? isRecording(session) : false }
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
      recordingStoppedAt: session.recordingStoppedAt,
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
    setCaptureStateForSession(session.sessionId, isRecording(session))
  }

  // After Stop, nothing joins the session and every tab drops its fetch/XHR
  // hooks; events after this time are left out of the report.
  const markSessionRecordingStopped = async (
    payload: MarkRecordingStoppedPayload
  ) => {
    await ensureLoaded()

    const session = sessionsById.get(payload.sessionId)
    if (!session || session.recordingStoppedAt !== null) {
      return
    }

    session.recordingStoppedAt = Math.floor(payload.recordingStoppedAt)
    schedulePersist()
    setCaptureStateForSession(session.sessionId, false)
  }

  const setSessionRecordingPaused = async (
    payload: SetRecordingPausedPayload
  ) => {
    await ensureLoaded()

    const session = sessionsById.get(payload.sessionId)
    if (!session) {
      return
    }

    session.recordingPausedAt =
      payload.pausedAt === null ? null : Math.floor(payload.pausedAt)
    schedulePersist()

    // The user may have moved to another tab while paused; the report shows
    // that switch at the moment the recording resumed.
    const activeTabId = session.activeTabId
    if (
      session.recordingPausedAt !== null ||
      !session.followTabs ||
      activeTabId === null ||
      activeTabId === session.lastSwitchTabId
    ) {
      return
    }

    const activeTab = await chrome.tabs.get(activeTabId).catch(() => null)
    if (activeTab && isTrackableTab(activeTab)) {
      await trackTab(session, activeTab)
      recordTabSwitch(session, activeTab)
    }
  }

  const setCaptureStateForSession = (sessionId: string, enabled: boolean) => {
    for (const [tabId, mappedSessionId] of tabToSession) {
      if (mappedSessionId === sessionId) {
        sendCaptureState(tabId, enabled)
      }
    }
  }

  // Persisted at once: a worker restart right after must not lose it.
  const markSessionBackgroundRecorder = async (sessionId: string) => {
    await ensureLoaded()

    const session = sessionsById.get(sessionId)
    if (!session || session.backgroundRecorder) {
      return
    }

    session.backgroundRecorder = true
    await persistState()
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

    session.activeTabId = tab.id
    schedulePersist()
    // A tab opened from a link is active before it has a URL; handleTabUpdated
    // records the switch once it does.
    if (isPaused(session) || !isTrackableTab(tab)) {
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
    if (
      !session ||
      isPaused(session) ||
      tab.incognito ||
      typeof tab.openerTabId !== "number"
    ) {
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

    // After Stop the report keeps the page as it was captured.
    const trackedSession = sessionsById.get(tabToSession.get(tab.id) ?? "")
    if (trackedSession && trackedSession.recordingStoppedAt === null) {
      updateSessionTabInfo(trackedSession, tab)
    }

    // The tab the user is on only now became a web page: a link opened in a
    // new tab, or a new tab where they typed a URL.
    const session = getJoinableSession()
    if (
      !session ||
      isPaused(session) ||
      session.activeTabId !== tab.id ||
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
      // Nothing can submit the session now. A review in its own tab uses the
      // logs saved at stop.
      if (
        !hasOpenTabs &&
        session.recorderTabId === null &&
        !isBackgroundRecordingRunning(session)
      ) {
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
    markSessionRecordingStopped,
    setSessionRecordingPaused,
    discardSession,
    markSessionBackgroundRecorder,
    ensureDebuggerScriptForTab,
    handleTabActivated,
    handleTabCreated,
    handleTabUpdated,
    handleTabRemoved,
    getCaptureState,
  }
}
