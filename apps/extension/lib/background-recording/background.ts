import { appendDebuggerSessionIdToUrl } from "@crikket/capture-core/debugger/recorder-session"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { getDebuggerSessionStore } from "@/lib/bug-report-debugger/engine/background"
import {
  setRecordingBadge,
  TOGGLE_MIC_MESSAGE_TYPE,
  type VideoSource,
} from "@/lib/capture-context"
import {
  captureFullPage,
  captureVisibleArea,
  type FullPageCapture,
  type FullPageProgress,
} from "@/lib/full-page-screenshot"
import { saveLogsBackup, saveScreenshot } from "@/lib/recording-store"
import {
  BACKGROUND_RECORDING_MESSAGE,
  BACKGROUND_RECORDING_STORAGE_KEY,
  type BackgroundRecordingState,
  FULL_PAGE_CAPTURE_STORAGE_KEY,
  OFFSCREEN_MESSAGE_TARGET,
  type OffscreenRequest,
  type OffscreenResponse,
  REVIEW_QUERY_PARAM,
  REVIEW_WIDE_QUERY_PARAM,
} from "./protocol"

const OFFSCREEN_DOCUMENT_PATH = "/offscreen.html"
const RECORDING_BAR_SCRIPT = "/content-scripts/recording-bar.js"
// Sent by the popup's Stop button and the stop hotkey for every recording.
const STOP_FROM_POPUP_MESSAGE_TYPE = "STOP_RECORDING_FROM_POPUP"

export interface StartRecordingInput {
  source: VideoSource
  tabId: number
  debuggerSessionId: string
}

// Keeps the DOMException name from the recorder, so the popup can tell a
// cancelled screen picker (NotAllowedError) from Chrome refusing to show it.
class RecordingStartError extends Error {
  readonly errorName: string | undefined

  constructor(message: string, errorName?: string) {
    super(message)
    this.errorName = errorName
  }
}

export async function readBackgroundRecording(): Promise<BackgroundRecordingState | null> {
  const result = await chrome.storage.local.get(
    BACKGROUND_RECORDING_STORAGE_KEY
  )
  return (
    (result[BACKGROUND_RECORDING_STORAGE_KEY] as
      | BackgroundRecordingState
      | undefined) ?? null
  )
}

// The full-page screenshot progress badge.
const BADGE_COLOR = "#f43f5e"

// The floating bar cannot appear everywhere (chrome:// pages, the new tab
// page, other apps), so the toolbar icon also shows that Crikket is recording,
// the same way as for a recording in a recorder tab.
async function showRecordingBadge(
  state: BackgroundRecordingState | null
): Promise<void> {
  if (!state) {
    await setRecordingBadge(null)
    return
  }
  await setRecordingBadge(state.pausedAt === null ? "recording" : "paused")
}

// Paused time is not in the report, so the session stops storing events.
async function syncDebuggerPause(
  sessionId: string,
  pausedAt: number | null
): Promise<void> {
  await getDebuggerSessionStore()
    ?.setSessionRecordingPaused({ sessionId, pausedAt })
    .catch((error: unknown) => {
      reportNonFatalError(
        `Failed to sync debugger pause for session ${sessionId}`,
        error
      )
    })
}

async function writeBackgroundRecording(
  state: BackgroundRecordingState
): Promise<void> {
  await chrome.storage.local.set({ [BACKGROUND_RECORDING_STORAGE_KEY]: state })
  await showRecordingBadge(state)
}

async function clearBackgroundRecording(): Promise<void> {
  await chrome.storage.local.remove(BACKGROUND_RECORDING_STORAGE_KEY)
  await showRecordingBadge(null)
}

export async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  })
  return contexts.length > 0
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    // USER_MEDIA for tab capture and the microphone, DISPLAY_MEDIA for the
    // screen picker of "Record Full Screen".
    reasons: [
      chrome.offscreen.Reason.USER_MEDIA,
      chrome.offscreen.Reason.DISPLAY_MEDIA,
    ],
    justification:
      "Records the tab or screen for a bug report without opening a new tab.",
  })
}

export async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument()
  }
}

export async function sendToOffscreen(
  request: OffscreenRequest
): Promise<OffscreenResponse> {
  try {
    const response = (await chrome.runtime.sendMessage({
      target: OFFSCREEN_MESSAGE_TARGET,
      request,
    })) as OffscreenResponse | undefined
    return response ?? { ok: false, error: "The recorder did not respond." }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Recorder unreachable.",
    }
  }
}

// Commands from the popup, the floating bar and hotkeys can arrive together;
// run them one at a time so they never overwrite each other's state.
let commandQueue: Promise<unknown> = Promise.resolve()
function runInOrder<T>(command: () => Promise<T>): Promise<T> {
  const result = commandQueue.then(command, command)
  commandQueue = result.catch(() => undefined)
  return result
}

// The offscreen recorder dies with the extension (reload, crash) while its
// state stays in storage; forget such a recording so the user can start over.
// Nothing was saved to review, so its debugger session goes too.
async function clearStaleBackgroundRecording(): Promise<void> {
  const state = await readBackgroundRecording()
  if (state && !(await hasOffscreenDocument())) {
    await clearBackgroundRecording()
    await getDebuggerSessionStore()?.discardSession(state.debuggerSessionId)
  }
}

// The debugger session of a capture made without a recorder tab must outlive
// worker restarts until its report is sent (see backgroundRecorder).
async function keepDebuggerSession(sessionId: string): Promise<void> {
  await getDebuggerSessionStore()
    ?.markSessionBackgroundRecorder(sessionId)
    .catch((error: unknown) => {
      reportNonFatalError(
        `Failed to keep debugger session ${sessionId} for its review`,
        error
      )
    })
}

// Saves a copy of the capture's logs next to it, so its review has them even
// if the live session is lost. Logs are the heart of a report.
export async function backUpLogs(sessionId: string): Promise<void> {
  try {
    const snapshot =
      await getDebuggerSessionStore()?.getSessionSnapshot(sessionId)
    if (snapshot) {
      await saveLogsBackup(sessionId, snapshot)
    }
  } catch (error) {
    reportNonFatalError(
      `Failed to back up the logs of debugger session ${sessionId}`,
      error
    )
  }
}

// Pages loaded before the extension (or before it was reloaded) lack a working
// floating bar script, so inject it unless the page answers. Inject right away
// instead of waiting for a heavy page to finish loading.
async function ensureRecordingBar(tabId: number): Promise<void> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: BACKGROUND_RECORDING_MESSAGE.barPing,
    })) as { ok?: boolean } | undefined
    if (response?.ok) return
  } catch {
    // No bar script listening on this page yet.
  }

  await chrome.scripting
    .executeScript({
      target: { tabId },
      files: [RECORDING_BAR_SCRIPT],
      injectImmediately: true,
    })
    .catch((error: unknown) => {
      // Browser pages such as chrome:// cannot be scripted; the popup still
      // controls the recording there.
      reportNonFatalError(
        `Failed to show the recording bar on tab ${tabId}`,
        error
      )
    })
}

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  })
  return typeof tab?.id === "number" ? tab.id : null
}

async function buildOffscreenStart(
  input: StartRecordingInput
): Promise<OffscreenRequest> {
  if (input.source === "display") {
    return {
      type: "start",
      source: "display",
      debuggerSessionId: input.debuggerSessionId,
    }
  }
  return {
    type: "start",
    source: "tab",
    streamId: await chrome.tabCapture.getMediaStreamId({
      targetTabId: input.tabId,
    }),
    debuggerSessionId: input.debuggerSessionId,
  }
}

export function startBackgroundRecording(
  input: StartRecordingInput
): Promise<void> {
  return runInOrder(async () => {
    await clearStaleBackgroundRecording()
    if (await readBackgroundRecording()) {
      throw new Error("A recording is already in progress.")
    }

    await keepDebuggerSession(input.debuggerSessionId)
    const request = await buildOffscreenStart(input)
    await ensureOffscreenDocument()
    const response = await sendToOffscreen(request)
    if (!response.ok) {
      await closeOffscreenDocument()
      throw new RecordingStartError(response.error, response.errorName)
    }

    await writeBackgroundRecording({
      source: input.source,
      tabId: input.tabId,
      debuggerSessionId: input.debuggerSessionId,
      startedAt: response.startedAt ?? Date.now(),
      pausedAt: null,
      pausedMs: 0,
      micState: response.micState ?? "unavailable",
    })

    await ensureRecordingBar(input.tabId)
    if (input.source === "display") {
      const activeTabId = await getActiveTabId()
      if (activeTabId !== null && activeTabId !== input.tabId) {
        await ensureRecordingBar(activeTabId)
      }
    }
  })
}

export function finishBackgroundRecording(): Promise<void> {
  return runInOrder(async () => {
    const state = await readBackgroundRecording()
    if (!state) return

    const response = await sendToOffscreen({ type: "stop" })
    await clearBackgroundRecording()
    await closeOffscreenDocument()

    if (!response.ok) {
      reportNonFatalError(
        "Failed to stop the background recording",
        new Error(response.error)
      )
      return
    }
    await backUpLogs(state.debuggerSessionId)
    await openReview({
      tabId: await getReviewTabId(state),
      debuggerSessionId: state.debuggerSessionId,
      captureType: "video",
    })
  })
}

function pauseBackgroundRecording(): Promise<void> {
  return runInOrder(async () => {
    const state = await readBackgroundRecording()
    if (!state || state.pausedAt !== null) return

    const response = await sendToOffscreen({ type: "pause" })
    if (response.ok) {
      const pausedAt = response.at ?? Date.now()
      await writeBackgroundRecording({ ...state, pausedAt })
      await syncDebuggerPause(state.debuggerSessionId, pausedAt)
    }
  })
}

function resumeBackgroundRecording(): Promise<void> {
  return runInOrder(async () => {
    const state = await readBackgroundRecording()
    if (!state || state.pausedAt === null) return

    const response = await sendToOffscreen({ type: "resume" })
    if (response.ok) {
      const resumedAt = response.at ?? Date.now()
      await writeBackgroundRecording({
        ...state,
        pausedAt: null,
        pausedMs: state.pausedMs + (resumedAt - state.pausedAt),
      })
      await syncDebuggerPause(state.debuggerSessionId, null)
    }
  })
}

/** Pauses a running background recording, or resumes a paused one. */
export async function toggleBackgroundRecordingPause(): Promise<void> {
  const state = await readBackgroundRecording()
  if (!state) return
  await (state.pausedAt === null
    ? pauseBackgroundRecording()
    : resumeBackgroundRecording())
}

function toggleBackgroundRecordingMic(): Promise<void> {
  return runInOrder(async () => {
    const state = await readBackgroundRecording()
    if (!state) return

    const response = await sendToOffscreen({ type: "toggle-mic" })
    if (response.ok && response.micState) {
      await writeBackgroundRecording({ ...state, micState: response.micState })
    }
  })
}

function dismissMutedWarning(): Promise<void> {
  return runInOrder(async () => {
    const state = await readBackgroundRecording()
    if (!state || state.mutedWarningDismissed) return
    await writeBackgroundRecording({ ...state, mutedWarningDismissed: true })
  })
}

// A full screen recording follows the user, so its review opens on the page
// they are on now; a tab recording's review opens on the recorded tab.
async function getReviewTabId(
  state: BackgroundRecordingState
): Promise<number> {
  if (state.source === "tab") return state.tabId
  return (await getActiveTabId()) ?? state.tabId
}

// Shows the review over the page, the way Jam does, and falls back to a tab
// when that page has no floating bar script (closed tab, chrome:// page).
export async function openReview(input: {
  tabId: number
  debuggerSessionId: string
  captureType: "video" | "screenshot" | "replay"
  wide?: boolean
}): Promise<void> {
  const reviewUrl = new URL(
    appendDebuggerSessionIdToUrl(
      chrome.runtime.getURL(`/recorder.html?captureType=${input.captureType}`),
      input.debuggerSessionId
    )
  )
  reviewUrl.searchParams.set(REVIEW_QUERY_PARAM, "1")
  if (input.wide) {
    reviewUrl.searchParams.set(REVIEW_WIDE_QUERY_PARAM, "1")
  }

  try {
    const { tabId } = input
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: BACKGROUND_RECORDING_MESSAGE.openReview,
      url: reviewUrl.toString(),
    })) as { ok?: boolean } | undefined
    if (response?.ok !== true) {
      throw new Error("The page did not open the review.")
    }
    const tab = await chrome.tabs.update(tabId, { active: true })
    if (typeof tab?.windowId === "number") {
      await chrome.windows.update(tab.windowId, { focused: true })
    }
  } catch {
    await chrome.tabs.create({ url: reviewUrl.toString(), active: true })
  }
}

export type ScreenshotMode = "visible" | "fullPage"

// Takes a screenshot of the tab (or all of the page) and opens its review over
// the page. A full-page capture shows its progress on the toolbar icon, which
// stays out of the screenshot.
// Shows how far a full-page screenshot got: on the toolbar icon, and in the
// popup when it is still open.
function reportFullPageProgress(progress: FullPageProgress): void {
  const percent = Math.round(
    (progress.screensDone / progress.screensTotal) * 100
  )
  chrome.action.setBadgeText({ text: `${percent}%` }).catch(() => undefined)
  chrome.storage.local
    .set({ [FULL_PAGE_CAPTURE_STORAGE_KEY]: progress })
    .catch(() => undefined)
}

// Set from the popup's "Stop here"; the capture checks it before each screen.
let isFullPageStopRequested = false

async function captureFullPageWithProgress(input: {
  tabId: number
  windowId: number
}): Promise<FullPageCapture> {
  isFullPageStopRequested = false
  await chrome.storage.local.set({
    [FULL_PAGE_CAPTURE_STORAGE_KEY]: { screensDone: 0, screensTotal: 0 },
  })
  try {
    return await captureFullPage({
      ...input,
      onProgress: reportFullPageProgress,
      shouldStop: () => isFullPageStopRequested,
    })
  } finally {
    await chrome.storage.local.remove(FULL_PAGE_CAPTURE_STORAGE_KEY)
  }
}

export async function takeScreenshot(input: {
  mode: ScreenshotMode
  tabId: number
  windowId: number
  debuggerSessionId: string
}): Promise<void> {
  await keepDebuggerSession(input.debuggerSessionId)
  try {
    const capture: FullPageCapture | null =
      input.mode === "fullPage"
        ? await captureFullPageWithProgress({
            tabId: input.tabId,
            windowId: input.windowId,
          })
        : null
    const image = capture?.image ?? (await captureVisibleArea(input.windowId))
    await saveScreenshot(
      input.debuggerSessionId,
      image,
      capture
        ? {
            screens: capture.screens,
            ending: capture.ending,
            scale: capture.scale,
          }
        : null
    )
    await backUpLogs(input.debuggerSessionId)
  } finally {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR })
    await showRecordingBadge(await readBackgroundRecording())
  }

  await openReview({
    tabId: input.tabId,
    debuggerSessionId: input.debuggerSessionId,
    captureType: "screenshot",
    wide: input.mode === "fullPage",
  })
}

// A full screen recording shows the floating bar on whichever tab is in front.
async function showBarIfRecordingScreen(tabId: number): Promise<void> {
  const state = await readBackgroundRecording()
  if (state?.source === "display") {
    await ensureRecordingBar(tabId)
  }
}

type MessageHandler = () => Promise<unknown>

function getMessageHandler(
  message: {
    type?: unknown
    source?: unknown
    mode?: unknown
    tabId?: unknown
    windowId?: unknown
    debuggerSessionId?: unknown
  },
  sender: chrome.runtime.MessageSender
): MessageHandler | null {
  switch (message.type) {
    case BACKGROUND_RECORDING_MESSAGE.start:
      return () =>
        startBackgroundRecording({
          source: message.source === "display" ? "display" : "tab",
          tabId: Number(message.tabId),
          debuggerSessionId: String(message.debuggerSessionId),
        })
    case BACKGROUND_RECORDING_MESSAGE.screenshot:
      return () =>
        takeScreenshot({
          mode: message.mode === "fullPage" ? "fullPage" : "visible",
          tabId: Number(message.tabId),
          windowId: Number(message.windowId),
          debuggerSessionId: String(message.debuggerSessionId),
        })
    case BACKGROUND_RECORDING_MESSAGE.screenshotStop:
      return () => {
        isFullPageStopRequested = true
        return Promise.resolve()
      }
    case BACKGROUND_RECORDING_MESSAGE.stop:
    case BACKGROUND_RECORDING_MESSAGE.ended:
    case STOP_FROM_POPUP_MESSAGE_TYPE:
      return finishBackgroundRecording
    case BACKGROUND_RECORDING_MESSAGE.pause:
      return pauseBackgroundRecording
    case BACKGROUND_RECORDING_MESSAGE.resume:
      return resumeBackgroundRecording
    case TOGGLE_MIC_MESSAGE_TYPE:
      return toggleBackgroundRecordingMic
    case BACKGROUND_RECORDING_MESSAGE.dismissMutedWarning:
      return dismissMutedWarning
    case BACKGROUND_RECORDING_MESSAGE.getTabId:
      return () => Promise.resolve({ tabId: sender.tab?.id ?? null })
    case BACKGROUND_RECORDING_MESSAGE.closeReview:
      return async () => {
        if (typeof sender.tab?.id === "number") {
          await chrome.tabs.sendMessage(sender.tab.id, {
            type: BACKGROUND_RECORDING_MESSAGE.closeReview,
          })
        }
      }
    default:
      return null
  }
}

export function registerBackgroundRecordingListeners(): void {
  runInOrder(clearStaleBackgroundRecording).catch((error: unknown) => {
    reportNonFatalError("Failed to check for a stale recording", error)
  })
  // A capture never outlives the worker, so its progress is stale.
  chrome.storage.local
    .remove(FULL_PAGE_CAPTURE_STORAGE_KEY)
    .catch(() => undefined)

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return

    const handler = getMessageHandler(message, sender)
    if (!handler) return

    handler().then(
      (data) => sendResponse({ ok: true, ...(data as object | undefined) }),
      (error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Recording failed.",
          errorName:
            error instanceof RecordingStartError ? error.errorName : undefined,
        })
    )
    return true
  })

  const reportBarError = (error: unknown) => {
    reportNonFatalError("Failed to show the recording bar", error)
  }
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    showBarIfRecordingScreen(tabId).catch(reportBarError)
  })
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return
    chrome.tabs
      .query({ active: true, windowId })
      .then(([tab]) =>
        typeof tab?.id === "number"
          ? showBarIfRecordingScreen(tab.id)
          : undefined
      )
      .catch(reportBarError)
  })
}
