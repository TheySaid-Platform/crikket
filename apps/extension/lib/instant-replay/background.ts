import { reportNonFatalError } from "@crikket/shared/lib/errors"
import {
  backUpLogs,
  closeOffscreenDocument,
  ensureOffscreenDocument,
  hasOffscreenDocument,
  openReview,
  readBackgroundRecording,
  runInOrder,
  sendToOffscreen,
} from "@/lib/background-recording/background"
import type { OffscreenRequest } from "@/lib/background-recording/protocol"
import { getDebuggerSessionStore } from "@/lib/bug-report-debugger/engine/background"
import {
  CAPTURE_CONTEXT_STORAGE_KEY,
  RECORDING_IN_PROGRESS_STORAGE_KEY,
  sanitizeCaptureContext,
  setRecordingBadge,
} from "@/lib/capture-context"
import { saveReplay } from "@/lib/recording-store"
import {
  type CollectReplayResponse,
  createReplayEndEvent,
  INSTANT_REPLAY_ENABLED_STORAGE_KEY,
  INSTANT_REPLAY_MESSAGE,
  INSTANT_REPLAY_VIDEO_STORAGE_KEY,
  INSTANT_REPLAY_WINDOW_MS,
  keepLastReplay,
  type ReplayEvent,
  type ReplayVideoSource,
  type ReplayVideoState,
} from "./protocol"

const NOTHING_TO_REPLAY_ERROR =
  "Instant replay has nothing for this page yet. Reload the page and try again."
const TURNED_OFF_ERROR = "Instant replay is off. Turn it on in Crikket first."
// Chrome stops an idle worker after 30 seconds and wipes its memory, which
// holds the console and network logs of the replay window. Any extension call
// keeps it awake.
const KEEP_AWAKE_INTERVAL_MS = 20_000

// The page scripts, registered only while instant replay is on, so no other
// page loads them. The recorder runs in the page's own world (see
// page-recorder.ts); the bridge talks to the extension.
const PAGE_SCRIPTS: chrome.scripting.RegisteredContentScript[] = [
  {
    id: "crikket-instant-replay-recorder",
    js: ["content-scripts/instant-replay-main.js"],
    matches: ["<all_urls>"],
    runAt: "document_idle",
    world: "MAIN",
  },
  {
    id: "crikket-instant-replay-bridge",
    js: ["content-scripts/instant-replay.js"],
    matches: ["<all_urls>"],
    runAt: "document_idle",
  },
]
const PAGE_SCRIPT_IDS = PAGE_SCRIPTS.map((script) => script.id)

// What earlier pages of each tab recorded. A reload or navigation ends the
// page's recorder, and hands its events over before it goes.
const earlierPages = new Map<number, ReplayEvent[]>()

async function isEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(
    INSTANT_REPLAY_ENABLED_STORAGE_KEY
  )
  return stored[INSTANT_REPLAY_ENABLED_STORAGE_KEY] === true
}

async function isRecording(): Promise<boolean> {
  const stored = await chrome.storage.local.get(
    RECORDING_IN_PROGRESS_STORAGE_KEY
  )
  return (
    stored[RECORDING_IN_PROGRESS_STORAGE_KEY] === true ||
    (await readBackgroundRecording()) !== null
  )
}

export async function readReplayVideo(): Promise<ReplayVideoState | null> {
  const stored = await chrome.storage.session.get(
    INSTANT_REPLAY_VIDEO_STORAGE_KEY
  )
  return (
    (stored[INSTANT_REPLAY_VIDEO_STORAGE_KEY] as
      | ReplayVideoState
      | undefined) ?? null
  )
}

// Closes the offscreen recorder too, unless a recording uses it.
async function forgetReplayVideo(): Promise<void> {
  await chrome.storage.session.remove(INSTANT_REPLAY_VIDEO_STORAGE_KEY)
  if (!(await readBackgroundRecording())) {
    await closeOffscreenDocument()
  }
}

// Tells the recorder to stop even when no video was saved as running: a start
// may still be on its way.
async function stopReplayVideoNow(): Promise<void> {
  if (await hasOffscreenDocument()) {
    await sendToOffscreen({ type: "replay-video-stop" })
  }
  await forgetReplayVideo()
}

export function stopReplayVideo(): Promise<void> {
  return runInOrder(stopReplayVideoNow)
}

/**
 * Keeps a video of the last minutes of a tab or the screen, in the offscreen
 * recorder. Chrome only lets an extension capture a tab after the user
 * clicked it there, so this runs from the popup.
 */
export function startReplayVideo(input: {
  source: ReplayVideoSource
  tabId: number
}): Promise<void> {
  return runInOrder(async () => {
    if (!(await isEnabled())) {
      throw new Error(TURNED_OFF_ERROR)
    }
    // Chrome cannot capture a tab twice, and a recording owns the recorder.
    if (await isRecording()) {
      throw new Error("Finish the recording first.")
    }
    await stopReplayVideoNow()

    const request: OffscreenRequest =
      input.source === "tab"
        ? {
            type: "replay-video-start",
            source: "tab",
            streamId: await chrome.tabCapture.getMediaStreamId({
              targetTabId: input.tabId,
            }),
          }
        : { type: "replay-video-start", source: "display" }
    await ensureOffscreenDocument()
    const response = await sendToOffscreen(request)
    if (!response.ok) {
      throw new Error(
        response.errorName === "NotAllowedError"
          ? "Screen sharing was cancelled."
          : response.error
      )
    }

    // Turned off while Chrome's picker was open, or while the capture started.
    if (!(await isEnabled())) {
      await stopReplayVideoNow()
      throw new Error(TURNED_OFF_ERROR)
    }
    await chrome.storage.session.set({
      [INSTANT_REPLAY_VIDEO_STORAGE_KEY]: {
        source: input.source,
        tabId: input.source === "tab" ? input.tabId : null,
        startedAt: response.startedAt ?? Date.now(),
      } satisfies ReplayVideoState,
    })
  })
}

function parseReplay(json: string | null | undefined): CollectReplayResponse {
  if (!json) return {}
  try {
    return JSON.parse(json) as CollectReplayResponse
  } catch {
    return {}
  }
}

function keepEarlierPage(tabId: number, json: unknown): void {
  const { events } = parseReplay(typeof json === "string" ? json : null)
  if (!events?.length) return
  const now = Date.now()
  earlierPages.set(
    tabId,
    keepLastReplay(
      [...(earlierPages.get(tabId) ?? []), ...events],
      INSTANT_REPLAY_WINDOW_MS,
      now
    )
  )
  // Pages whose replay is older than the window are of no use any more.
  for (const [otherTabId, otherEvents] of earlierPages) {
    if ((otherEvents.at(-1)?.timestamp ?? 0) < now - INSTANT_REPLAY_WINDOW_MS) {
      earlierPages.delete(otherTabId)
    }
  }
}

// This page's replay, after what earlier pages of the tab recorded.
async function collectPageReplay(tabId: number): Promise<ReplayEvent[]> {
  let response: { json?: string | null } | undefined
  try {
    response = await chrome.tabs.sendMessage(
      tabId,
      { type: INSTANT_REPLAY_MESSAGE.collect },
      { frameId: 0 }
    )
  } catch {
    // No instant replay script on this page: a browser page, or one opened
    // before Crikket was installed or updated.
  }
  const page = parseReplay(response?.json)
  if (page.error) {
    throw new Error(page.error)
  }
  const now = Date.now()
  const events = keepLastReplay(
    [...(earlierPages.get(tabId) ?? []), ...(page.events ?? [])],
    INSTANT_REPLAY_WINDOW_MS,
    now
  )
  // At least the first full snapshot (Meta and FullSnapshot).
  if (events.length < 2) {
    throw new Error(NOTHING_TO_REPLAY_ERROR)
  }
  return [...events, createReplayEndEvent(now)]
}

// A finished capture's debugger session, holding the logs of the replay's
// minutes from the tab it was shared from.
async function startReplaySession(input: {
  tabId: number
  startedAt: number
  stoppedAt: number
}): Promise<string> {
  const store = getDebuggerSessionStore()
  if (!store) {
    throw new Error("Crikket is still starting. Try again.")
  }
  const { sessionId } = await store.startSession({
    captureTabId: input.tabId,
    captureType: "video",
    instantReplayLookbackMs: Date.now() - input.startedAt,
  })
  await store.markSessionBackgroundRecorder(sessionId)
  await store.markSessionRecordingStarted({
    sessionId,
    recordingStartedAt: input.startedAt,
  })
  await store.markSessionRecordingStopped({
    sessionId,
    recordingStoppedAt: input.stoppedAt,
  })
  return sessionId
}

async function openReplayReview(input: {
  tabId: number
  sessionId: string
  captureType: "video" | "replay"
}): Promise<void> {
  await backUpLogs(input.sessionId)
  const tab = await chrome.tabs.get(input.tabId)
  await chrome.storage.local.set({
    [CAPTURE_CONTEXT_STORAGE_KEY]: sanitizeCaptureContext({
      title: tab.title,
      url: tab.url,
    }),
  })
  await openReview({
    tabId: input.tabId,
    debuggerSessionId: input.sessionId,
    captureType: input.captureType,
  })
}

// The video of the last minutes, reviewed like any recording.
async function saveVideoReplay(tabId: number): Promise<void> {
  const clip = await sendToOffscreen({ type: "replay-video-save" })
  if (!(clip.ok && clip.startedAt && clip.at)) {
    throw new Error(clip.ok ? "The video clip is empty." : clip.error)
  }
  const sessionId = await startReplaySession({
    tabId,
    startedAt: clip.startedAt,
    stoppedAt: clip.at,
  })
  const stored = await sendToOffscreen({
    type: "replay-video-store",
    debuggerSessionId: sessionId,
  })
  if (!stored.ok) {
    await getDebuggerSessionStore()?.discardSession(sessionId)
    throw new Error(stored.error)
  }
  await openReplayReview({ tabId, sessionId, captureType: "video" })
}

// The page's DOM replay, for tabs without a video.
async function savePageReplay(tabId: number): Promise<void> {
  const events = await collectPageReplay(tabId)
  const startedAt = events[0].timestamp
  const stoppedAt = events.at(-1)?.timestamp ?? Date.now()
  const sessionId = await startReplaySession({ tabId, startedAt, stoppedAt })
  await saveReplay(sessionId, { events, startedAt, stoppedAt })
  await openReplayReview({ tabId, sessionId, captureType: "replay" })
}

/**
 * Turns the last minutes of a tab into a capture and opens its review over
 * the page: the video when there is one for this tab, else the page replay.
 */
export function saveInstantReplay(tabId: number): Promise<void> {
  return runInOrder(async () => {
    if (!(await isEnabled())) {
      throw new Error(TURNED_OFF_ERROR)
    }
    // A recording follows the newest debugger session, which this would
    // replace.
    if (await isRecording()) {
      throw new Error("Finish the recording first.")
    }

    const video = await readReplayVideo()
    if (video && (video.source === "display" || video.tabId === tabId)) {
      try {
        await saveVideoReplay(tabId)
        return
      } catch (error) {
        reportNonFatalError(
          "Failed to save the instant replay video, using the page replay",
          error
        )
      }
    }
    await savePageReplay(tabId)
  })
}

// Pages already open start keeping their last minutes at once.
async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] })
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") return
      for (const script of PAGE_SCRIPTS) {
        await chrome.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: script.js ?? [],
            world: script.world,
          })
          .catch(() => undefined)
      }
    })
  )
}

async function syncPageScripts(enabled: boolean): Promise<void> {
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: PAGE_SCRIPT_IDS,
  })
  if (enabled && registered.length === PAGE_SCRIPTS.length) return
  if (registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({
      ids: registered.map((script) => script.id),
    })
  }
  if (enabled) {
    await chrome.scripting.registerContentScripts(PAGE_SCRIPTS)
  }
}

async function applySetting(
  enabled: boolean,
  options: { injectIntoOpenTabs: boolean }
): Promise<void> {
  getDebuggerSessionStore()?.setInstantReplayEnabled(enabled)
  await syncPageScripts(enabled)
  if (enabled && options.injectIntoOpenTabs) {
    await injectIntoOpenTabs()
  }
  if (!enabled) {
    earlierPages.clear()
    await stopReplayVideo()
  }
  if (!(await isRecording())) {
    await setRecordingBadge(null)
  }
}

type MessageHandler = () => Promise<unknown>

function getMessageHandler(
  message: {
    type?: unknown
    tabId?: unknown
    source?: unknown
    json?: unknown
  },
  sender: chrome.runtime.MessageSender
): MessageHandler | null {
  switch (message.type) {
    case INSTANT_REPLAY_MESSAGE.save:
      return () => saveInstantReplay(Number(message.tabId))
    case INSTANT_REPLAY_MESSAGE.videoStart:
      return () =>
        startReplayVideo({
          source: message.source === "display" ? "display" : "tab",
          tabId: Number(message.tabId),
        })
    case INSTANT_REPLAY_MESSAGE.videoStop:
      return stopReplayVideo
    case INSTANT_REPLAY_MESSAGE.videoEnded:
      return () => runInOrder(forgetReplayVideo)
    case INSTANT_REPLAY_MESSAGE.pageLeft:
      return () => {
        if (typeof sender.tab?.id === "number" && sender.frameId === 0) {
          keepEarlierPage(sender.tab.id, message.json)
        }
        return Promise.resolve()
      }
    default:
      return null
  }
}

export function registerInstantReplayListeners(): void {
  // Read from memory: a storage read every tick would keep the worker awake
  // even with instant replay off.
  let enabled = false
  const reportError = (error: unknown) => {
    reportNonFatalError("Failed to apply the instant replay setting", error)
  }
  isEnabled()
    .then((value) => {
      enabled = value
      return applySetting(value, { injectIntoOpenTabs: false })
    })
    .catch(reportError)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    const change = changes[INSTANT_REPLAY_ENABLED_STORAGE_KEY]
    if (areaName !== "local" || !change) return
    enabled = change.newValue === true
    applySetting(enabled, { injectIntoOpenTabs: true }).catch(reportError)
  })
  // An update leaves open pages with the old scripts, which can no longer
  // reach the extension.
  chrome.runtime.onInstalled.addListener(() => {
    isEnabled()
      .then((value) => (value ? injectIntoOpenTabs() : undefined))
      .catch(reportError)
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    earlierPages.delete(tabId)
  })
  // ponytail: keeps the worker alive while instant replay is on; persist the
  // recent logs to chrome.storage.session if Chrome stops honoring this.
  setInterval(() => {
    if (enabled) {
      chrome.runtime.getPlatformInfo().catch(() => undefined)
    }
  }, KEEP_AWAKE_INTERVAL_MS)

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return
    const handler = getMessageHandler(message, sender)
    if (!handler) return

    handler().then(
      () => sendResponse({ ok: true }),
      (error: unknown) => {
        reportNonFatalError("Instant replay failed", error)
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Instant replay failed.",
        })
      }
    )
    return true
  })
}
