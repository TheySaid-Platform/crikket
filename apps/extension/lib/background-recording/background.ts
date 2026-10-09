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
import {
  deleteRecording,
  listStoredCaptureIds,
  saveLogsBackup,
  saveScreenshot,
} from "@/lib/recording-store"
import { delay } from "@/lib/utils"
import { planStartupCleanup } from "./capture-cleanup"
import {
  BACKGROUND_RECORDING_MESSAGE,
  BACKGROUND_RECORDING_STORAGE_KEY,
  type BackgroundRecordingState,
  FULL_PAGE_CAPTURE_STORAGE_KEY,
  isPickerUnavailableError,
  isUserCancelError,
  OFFSCREEN_MESSAGE_TARGET,
  type OffscreenRequest,
  type OffscreenResponse,
  PENDING_REVIEW_STORAGE_KEY,
  type PendingReview,
  RECORDING_ERROR_STORAGE_KEY,
  REVIEW_QUERY_PARAM,
  REVIEW_WIDE_QUERY_PARAM,
  readReviewSessionId,
} from "./protocol"

const OFFSCREEN_DOCUMENT_PATH = "/offscreen.html"
// The floating bar and the review overlay, injected only where needed.
const PAGE_SCRIPT = "content-scripts/recording-bar.js"
// While recording, the same script runs from document_start on pages that load.
const BAR_SCRIPT_ID = "crikket-recording-bar"
const RECORDER_PAGE_PATH = "/recorder.html"
// Sent by the popup's Stop button and the stop hotkey for every recording.
const STOP_FROM_POPUP_MESSAGE_TYPE = "STOP_RECORDING_FROM_POPUP"

export interface StartRecordingInput {
  source: VideoSource
  tabId: number
  debuggerSessionId: string
}

// Keeps the recorder's DOMException name (see OffscreenResponse).
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

// The long screenshot progress badge.
const BADGE_COLOR = "#f43f5e"
// Time for a page to repaint after the old review is hidden.
const REPAINT_MS = 150
const STARTUP_CLEANUP_DELAY_MS = 5000

// The floating bar cannot show everywhere (chrome:// pages, other apps), so
// the toolbar icon shows the recording state too.
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

// Sent rather than read from chrome.storage.onChanged, which would also hand
// every bar each write of the debugger sessions.
async function sendBarState(
  state: BackgroundRecordingState | null
): Promise<void> {
  const tabs = await chrome.tabs.query({})
  await Promise.all(
    tabs.map((tab) =>
      typeof tab.id === "number"
        ? chrome.tabs
            .sendMessage(tab.id, {
              type: BACKGROUND_RECORDING_MESSAGE.barState,
              state,
            })
            .catch(() => undefined)
        : undefined
    )
  )
}

async function registerBarScript(): Promise<void> {
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [BAR_SCRIPT_ID],
  })
  if (registered.length > 0) return
  await chrome.scripting.registerContentScripts([
    {
      id: BAR_SCRIPT_ID,
      js: [PAGE_SCRIPT],
      matches: ["<all_urls>"],
      runAt: "document_start",
      persistAcrossSessions: false,
    },
  ])
}

async function unregisterBarScript(): Promise<void> {
  await chrome.scripting
    .unregisterContentScripts({ ids: [BAR_SCRIPT_ID] })
    .catch(() => undefined)
}

async function writeBackgroundRecording(
  state: BackgroundRecordingState
): Promise<void> {
  await chrome.storage.local.set({ [BACKGROUND_RECORDING_STORAGE_KEY]: state })
  await showRecordingBadge(state)
  await sendBarState(state)
}

async function clearBackgroundRecording(): Promise<void> {
  await chrome.storage.local.remove(BACKGROUND_RECORDING_STORAGE_KEY)
  await showRecordingBadge(null)
  await unregisterBarScript()
  await sendBarState(null)
}

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  })
  return contexts.length > 0
}

async function ensureOffscreenDocument(): Promise<void> {
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

async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument()
  }
}

async function sendToOffscreen(
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

async function discardDebuggerSession(sessionId: string): Promise<void> {
  await getDebuggerSessionStore()
    ?.discardSession(sessionId)
    .catch((error: unknown) => {
      reportNonFatalError(
        `Failed to discard debugger session ${sessionId}`,
        error
      )
    })
}

async function readPendingReview(): Promise<PendingReview | null> {
  const result = await chrome.storage.local.get(PENDING_REVIEW_STORAGE_KEY)
  return (
    (result[PENDING_REVIEW_STORAGE_KEY] as PendingReview | undefined) ?? null
  )
}

// A capture that will not be reviewed: drop its session, file and logs copy.
async function abandonCapture(sessionId: string): Promise<void> {
  await discardDebuggerSession(sessionId)
  await deleteRecording(sessionId).catch((error: unknown) => {
    reportNonFatalError(`Failed to delete the capture of ${sessionId}`, error)
  })
  const pending = await readPendingReview()
  if (pending?.debuggerSessionId === sessionId) {
    await chrome.storage.local.remove(PENDING_REVIEW_STORAGE_KEY)
  }
}

// The offscreen recorder dies with the extension (reload, crash) while its
// state stays in storage: forget that recording so the user can start over.
async function clearStaleBackgroundRecording(): Promise<void> {
  const state = await readBackgroundRecording()
  if (!state) {
    await unregisterBarScript()
  } else if (!(await hasOffscreenDocument())) {
    await clearBackgroundRecording()
    await abandonCapture(state.debuggerSessionId)
  }
}

// Keeps the session across worker restarts (see backgroundRecorder).
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

// In case the live session is lost before the review loads it.
async function backUpLogs(sessionId: string): Promise<void> {
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

// chrome:// pages cannot be scripted; the popup controls the recording there.
async function ensurePageScript(tabId: number): Promise<void> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: BACKGROUND_RECORDING_MESSAGE.barPing,
    })) as { ok?: boolean } | undefined
    if (response?.ok) return
  } catch {
    // Not running on this page yet.
  }

  await chrome.scripting
    .executeScript({
      target: { tabId },
      files: [PAGE_SCRIPT],
      injectImmediately: true,
    })
    .catch((error: unknown) => {
      reportNonFatalError(
        `Failed to add the page script to tab ${tabId}`,
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

// While a new capture starts, an unsent review over the page is hidden so it
// is not captured. True if there was one to hide or show.
async function setPendingReviewHidden(hidden: boolean): Promise<boolean> {
  const pending = await readPendingReview()
  if (!pending?.isOverlay) return false
  await chrome.tabs
    .sendMessage(pending.tabId, {
      type: BACKGROUND_RECORDING_MESSAGE.hideReview,
      hidden,
    })
    .catch(() => undefined)
  return true
}

// A new capture that worked replaces the review that was never sent.
async function abandonPendingReview(): Promise<void> {
  const pending = await readPendingReview()
  if (!pending) return
  await abandonCapture(pending.debuggerSessionId)
  if (pending.isOverlay) {
    await chrome.tabs
      .sendMessage(pending.tabId, {
        type: BACKGROUND_RECORDING_MESSAGE.closeReview,
      })
      .catch(() => undefined)
  } else {
    await chrome.tabs.remove(pending.tabId).catch(() => undefined)
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
    await setPendingReviewHidden(true)
    const response = await sendToOffscreen(request)
    if (!response.ok) {
      return handleStartFailure(input.debuggerSessionId, response)
    }
    await abandonPendingReview()

    await writeBackgroundRecording({
      source: input.source,
      tabId: input.tabId,
      debuggerSessionId: input.debuggerSessionId,
      startedAt: response.startedAt ?? Date.now(),
      pausedAt: null,
      pausedMs: 0,
      micState: response.micState ?? "unavailable",
    })

    await registerBarScript()
    await ensurePageScript(input.tabId)
    if (input.source === "display") {
      await showBarInFrontTabs()
    }
  })
}

async function handleStartFailure(
  sessionId: string,
  response: Extract<OffscreenResponse, { ok: false }>
): Promise<never> {
  await closeOffscreenDocument()
  await setPendingReviewHidden(false)
  // The popup goes on with this session only if the picker could not show;
  // otherwise it has usually closed, so the session is dropped here.
  if (!isPickerUnavailableError(response.errorName)) {
    await discardDebuggerSession(sessionId)
    if (!isUserCancelError(response.errorName, response.error)) {
      await reportErrorIfPopupClosed(
        `Your recording could not start: ${response.error}`
      )
    }
  }
  throw new RecordingStartError(response.error, response.errorName)
}

// The tab in front of every window, also of windows that are not focused.
async function showBarInFrontTabs(): Promise<void> {
  for (const tab of await chrome.tabs.query({ active: true })) {
    if (typeof tab.id === "number") {
      await ensurePageScript(tab.id)
    }
  }
}

async function markDebuggerSessionStopped(sessionId: string): Promise<void> {
  await getDebuggerSessionStore()
    ?.markSessionRecordingStopped({
      sessionId,
      recordingStoppedAt: Date.now(),
    })
    .catch((error: unknown) => {
      reportNonFatalError(
        `Failed to mark debugger session ${sessionId} stopped`,
        error
      )
    })
}

// Shown once in the popup; the toolbar icon shows "!" until then.
async function reportRecordingError(message: string): Promise<void> {
  await chrome.storage.local.set({ [RECORDING_ERROR_STORAGE_KEY]: message })
  await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" })
  await chrome.action.setBadgeText({ text: "!" })
}

// An open popup shows the error itself. It usually closes when Chrome's
// screen picker opens or the user switches tabs, and then nothing would.
async function reportErrorIfPopupClosed(message: string): Promise<void> {
  const popups = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.POPUP],
  })
  if (popups.length === 0) {
    await reportRecordingError(message)
  }
}

export function finishBackgroundRecording(): Promise<void> {
  return runInOrder(async () => {
    const state = await readBackgroundRecording()
    if (!state) return

    // Stopped here first, so the session stops following tabs even if the
    // recorder cannot finish.
    await markDebuggerSessionStopped(state.debuggerSessionId)
    const response = await sendToOffscreen({ type: "stop" })
    await clearBackgroundRecording()
    await closeOffscreenDocument()

    if (!response.ok) {
      // Saving failed (usually a full disk), so there is nothing to review.
      await abandonCapture(state.debuggerSessionId)
      await reportRecordingError(
        `Your last recording could not be saved: ${response.error}`
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

// False when the page cannot show it (closed, or cannot be scripted).
async function showReviewOverlay(tabId: number, url: string): Promise<boolean> {
  await ensurePageScript(tabId)
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: BACKGROUND_RECORDING_MESSAGE.openReview,
      url,
    })) as { ok?: boolean } | undefined
    return response?.ok === true
  } catch {
    return false
  }
}

async function focusTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.update(tabId, { active: true })
  if (typeof tab?.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true })
  }
}

// Shows the review over the page, or in a tab of its own when the page cannot
// show it. Remembered until it is sent or dropped, so it survives a reload.
async function openReview(input: {
  tabId: number
  debuggerSessionId: string
  captureType: "video" | "screenshot"
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
  const url = reviewUrl.toString()

  let pending: PendingReview
  if (await showReviewOverlay(input.tabId, url)) {
    await focusTab(input.tabId).catch(() => undefined)
    pending = {
      tabId: input.tabId,
      url,
      debuggerSessionId: input.debuggerSessionId,
      isOverlay: true,
    }
  } else {
    const tab = await chrome.tabs.create({ url, active: true })
    pending = {
      tabId: tab.id ?? -1,
      url,
      debuggerSessionId: input.debuggerSessionId,
      isOverlay: false,
    }
  }
  await chrome.storage.local.set({ [PENDING_REVIEW_STORAGE_KEY]: pending })
}

async function isPendingReviewShown(pending: PendingReview): Promise<boolean> {
  const tab = await chrome.tabs.get(pending.tabId).catch(() => null)
  if (!tab) return false
  if (pending.isOverlay) return showReviewOverlay(pending.tabId, pending.url)
  const recorderPageUrl = chrome.runtime.getURL(RECORDER_PAGE_PATH)
  return (
    readReviewSessionId(tab.url, recorderPageUrl) === pending.debuggerSessionId
  )
}

// From the popup: back to the review that is not sent yet. If its tab cannot
// show it any more (an error page, or the review's tab went elsewhere), it
// opens in a new tab.
async function reopenPendingReview(): Promise<void> {
  const pending = await readPendingReview()
  if (!pending) return
  if (await isPendingReviewShown(pending)) {
    await focusTab(pending.tabId)
    return
  }
  const tab = await chrome.tabs.create({ url: pending.url, active: true })
  const moved: PendingReview = {
    ...pending,
    tabId: tab.id ?? -1,
    isOverlay: false,
  }
  await chrome.storage.local.set({ [PENDING_REVIEW_STORAGE_KEY]: moved })
}

export type ScreenshotMode = "visible" | "fullPage"

// On the toolbar icon, and in the popup when it is open.
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

// After the long screenshot's percentage.
async function restoreBadge(): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR })
  await showRecordingBadge(await readBackgroundRecording())
}

export async function takeScreenshot(input: {
  mode: ScreenshotMode
  tabId: number
  windowId: number
  debuggerSessionId: string
}): Promise<void> {
  await keepDebuggerSession(input.debuggerSessionId)
  // Gives the page a frame to repaint without the old review.
  if (await setPendingReviewHidden(true)) await delay(REPAINT_MS)
  try {
    const capture: FullPageCapture | null =
      input.mode === "fullPage"
        ? await captureFullPageWithProgress({
            tabId: input.tabId,
            windowId: input.windowId,
          })
        : null
    const image = capture?.image ?? (await captureVisibleArea(input.windowId))
    // Like Stop for a recording: nothing after the screenshot is reported.
    await markDebuggerSessionStopped(input.debuggerSessionId)
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
  } catch (error) {
    await abandonCapture(input.debuggerSessionId)
    await setPendingReviewHidden(false)
    await restoreBadge()
    const reason = error instanceof Error ? error.message : "unknown error"
    await reportErrorIfPopupClosed(
      `Your screenshot could not be taken: ${reason}`
    )
    throw error
  }
  await restoreBadge()

  await abandonPendingReview()
  await openReview({
    tabId: input.tabId,
    debuggerSessionId: input.debuggerSessionId,
    captureType: "screenshot",
    wide: input.mode === "fullPage",
  })
}

// The bar has to be added again after the page reloads or navigates.
async function showBarIfNeeded(tabId: number): Promise<void> {
  const state = await readBackgroundRecording()
  if (!state) return
  if (state.source === "display" || state.tabId === tabId) {
    await ensurePageScript(tabId)
  }
}

async function handleTabLoaded(tabId: number): Promise<void> {
  await showBarIfNeeded(tabId)
  const pending = await readPendingReview()
  if (pending?.isOverlay && pending.tabId === tabId) {
    await showReviewOverlay(tabId, pending.url)
  }
}

// The review was in this tab and was not sent: drop its capture.
async function handleTabClosed(tabId: number): Promise<void> {
  const pending = await readPendingReview()
  if (pending?.tabId === tabId) {
    await abandonCapture(pending.debuggerSessionId)
  }
}

// Review tabs Chrome restored after a restart, by the capture they show.
async function findReviewTabs(): Promise<Map<string, PendingReview>> {
  const recorderPageUrl = chrome.runtime.getURL(RECORDER_PAGE_PATH)
  const reviews = new Map<string, PendingReview>()
  for (const tab of await chrome.tabs.query({})) {
    const url = tab.url || tab.pendingUrl
    const sessionId = readReviewSessionId(url, recorderPageUrl)
    if (sessionId && url && typeof tab.id === "number") {
      reviews.set(sessionId, {
        tabId: tab.id,
        url,
        debuggerSessionId: sessionId,
        isOverlay: false,
      })
    }
  }
  return reviews
}

// After a browser restart the live sessions are gone, so stored captures are
// removed, except those of review tabs Chrome restored (see planStartupCleanup).
async function removeOrphanedCaptures(): Promise<void> {
  // Chrome may still be restoring tabs when it starts the extension.
  await delay(STARTUP_CLEANUP_DELAY_MS)
  await chrome.storage.local.remove(PENDING_REVIEW_STORAGE_KEY)
  const storedIds = await listStoredCaptureIds()
  const store = getDebuggerSessionStore()
  const liveSessionIds = new Set<string>()
  for (const sessionId of storedIds) {
    if (await store?.getSessionSnapshot(sessionId).catch(() => null)) {
      liveSessionIds.add(sessionId)
    }
  }
  const plan = planStartupCleanup({
    storedIds,
    liveSessionIds,
    reviewTabs: await findReviewTabs(),
  })
  for (const sessionId of plan.remove) {
    await deleteRecording(sessionId)
  }
  if (plan.pending) {
    await chrome.storage.local.set({
      [PENDING_REVIEW_STORAGE_KEY]: plan.pending,
    })
  }
}

// The report was sent or dropped. The files are deleted here because the
// review's own delete stops when its overlay closes.
async function finishReview(sessionId: string): Promise<void> {
  await deleteRecording(sessionId).catch((error: unknown) => {
    reportNonFatalError(`Failed to delete the capture of ${sessionId}`, error)
  })
  const pending = await readPendingReview()
  if (pending?.debuggerSessionId === sessionId) {
    await chrome.storage.local.remove(PENDING_REVIEW_STORAGE_KEY)
  }
}

async function closeReview(tabId: number | undefined): Promise<void> {
  if (typeof tabId !== "number") return
  await chrome.tabs
    .sendMessage(tabId, { type: BACKGROUND_RECORDING_MESSAGE.closeReview })
    .catch(() => undefined)
  const pending = await readPendingReview()
  if (pending?.tabId === tabId) {
    await chrome.storage.local.remove(PENDING_REVIEW_STORAGE_KEY)
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
      return () => closeReview(sender.tab?.id)
    case BACKGROUND_RECORDING_MESSAGE.reopenReview:
      return reopenPendingReview
    case BACKGROUND_RECORDING_MESSAGE.reviewDone:
      return () => finishReview(String(message.debuggerSessionId))
    default:
      return null
  }
}

function registerTabListeners(): void {
  const reportTabError = (error: unknown) => {
    reportNonFatalError("Failed to update a tab for the recording", error)
  }
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    showBarIfNeeded(tabId).catch(reportTabError)
  })
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete") {
      handleTabLoaded(tabId).catch(reportTabError)
    }
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    handleTabClosed(tabId).catch(reportTabError)
  })
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return
    chrome.tabs
      .query({ active: true, windowId })
      .then(([tab]) =>
        typeof tab?.id === "number" ? showBarIfNeeded(tab.id) : undefined
      )
      .catch(reportTabError)
  })
}

export function registerBackgroundRecordingListeners(): void {
  runInOrder(clearStaleBackgroundRecording).catch((error: unknown) => {
    reportNonFatalError("Failed to check for a stale recording", error)
  })
  // A capture never outlives the worker, so its progress is stale.
  chrome.storage.local
    .remove(FULL_PAGE_CAPTURE_STORAGE_KEY)
    .catch(() => undefined)
  chrome.runtime.onStartup.addListener(() => {
    removeOrphanedCaptures().catch((error: unknown) => {
      reportNonFatalError("Failed to remove old captures", error)
    })
  })

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

  registerTabListeners()
}
