import { reportNonFatalError } from "@crikket/shared/lib/errors"
import {
  backUpLogs,
  closeOffscreenDocument,
  ensureOffscreenDocument,
  hasOffscreenDocument,
  openReview,
  readBackgroundRecording,
  sendToOffscreen,
} from "@/lib/background-recording/background"
import type { OffscreenRequest } from "@/lib/background-recording/protocol"
import { getDebuggerSessionStore } from "@/lib/bug-report-debugger/engine/background"
import {
  CAPTURE_CONTEXT_STORAGE_KEY,
  RECORDING_IN_PROGRESS_STORAGE_KEY,
  sanitizeCaptureContext,
} from "@/lib/capture-context"
import { saveReplay } from "@/lib/recording-store"
import {
  type CollectReplayResponse,
  INSTANT_REPLAY_ENABLED_STORAGE_KEY,
  INSTANT_REPLAY_MESSAGE,
  INSTANT_REPLAY_VIDEO_STORAGE_KEY,
  type ReplayEvent,
  type ReplayVideoSource,
  type ReplayVideoState,
} from "./protocol"

const NOTHING_TO_REPLAY_ERROR =
  "Instant replay has nothing for this page yet. Reload the page and try again."
// Chrome stops an idle worker after 30 seconds and wipes its memory, which
// holds the console and network logs of the replay window. Any extension call
// keeps it awake.
const KEEP_AWAKE_INTERVAL_MS = 20_000

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

/**
 * Keeps a video of the last minutes of a tab or the screen, in the offscreen
 * recorder. Chrome only lets an extension capture a tab after the user
 * clicked it there, so this runs from the popup.
 */
export async function startReplayVideo(input: {
  source: ReplayVideoSource
  tabId: number
}): Promise<void> {
  // Chrome cannot capture a tab twice, and a recording owns the recorder.
  if (await isRecording()) {
    throw new Error("Finish the recording first.")
  }
  await stopReplayVideo()

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

  await chrome.storage.session.set({
    [INSTANT_REPLAY_VIDEO_STORAGE_KEY]: {
      source: input.source,
      tabId: input.source === "tab" ? input.tabId : null,
      startedAt: response.startedAt ?? Date.now(),
    } satisfies ReplayVideoState,
  })
}

// Closes the offscreen recorder too, unless a recording uses it.
async function forgetReplayVideo(): Promise<void> {
  await chrome.storage.session.remove(INSTANT_REPLAY_VIDEO_STORAGE_KEY)
  if (!(await readBackgroundRecording())) {
    await closeOffscreenDocument()
  }
}

export async function stopReplayVideo(): Promise<void> {
  if (!(await readReplayVideo())) return
  if (await hasOffscreenDocument()) {
    await sendToOffscreen({ type: "replay-video-stop" })
  }
  await forgetReplayVideo()
}

async function collectPageReplay(tabId: number): Promise<ReplayEvent[]> {
  let response: CollectReplayResponse | undefined
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
  if (response?.error) {
    throw new Error(response.error)
  }
  // At least the first full snapshot (Meta and FullSnapshot) and the end.
  const events = response?.events ?? []
  if (events.length < 3) {
    throw new Error(NOTHING_TO_REPLAY_ERROR)
  }
  return events
}

// A finished capture's debugger session, holding the logs of the replay's
// minutes, which the worker keeps for every tab.
async function startReplaySession(input: {
  tabId: number
  startedAt: number
  stoppedAt: number
  allTabs: boolean
}): Promise<string> {
  const store = getDebuggerSessionStore()
  if (!store) {
    throw new Error("Crikket is still starting. Try again.")
  }
  const { sessionId } = await store.startSession({
    captureTabId: input.tabId,
    captureType: "video",
    instantReplayLookbackMs: Date.now() - input.startedAt,
    instantReplayAllTabs: input.allTabs,
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
async function saveVideoReplay(
  tabId: number,
  video: ReplayVideoState
): Promise<void> {
  const clip = await sendToOffscreen({ type: "replay-video-save" })
  if (!(clip.ok && clip.startedAt && clip.at)) {
    throw new Error(clip.ok ? "The video clip is empty." : clip.error)
  }
  const sessionId = await startReplaySession({
    tabId,
    startedAt: clip.startedAt,
    stoppedAt: clip.at,
    allTabs: video.source === "display",
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
  const sessionId = await startReplaySession({
    tabId,
    startedAt,
    stoppedAt,
    allTabs: false,
  })
  await saveReplay(sessionId, { events, startedAt, stoppedAt })
  await openReplayReview({ tabId, sessionId, captureType: "replay" })
}

/**
 * Turns the last minutes of a tab into a capture and opens its review over
 * the page: the video when there is one for this tab, else the page replay.
 */
export async function saveInstantReplay(tabId: number): Promise<void> {
  // A recording follows the newest debugger session, which this would replace.
  if (await isRecording()) {
    throw new Error("Finish the recording first.")
  }

  const video = await readReplayVideo()
  if (video && (video.source === "display" || video.tabId === tabId)) {
    try {
      await saveVideoReplay(tabId, video)
      return
    } catch (error) {
      reportNonFatalError(
        "Failed to save the instant replay video, using the page replay",
        error
      )
    }
  }
  await savePageReplay(tabId)
}

type MessageHandler = () => Promise<unknown>

function getMessageHandler(message: {
  type?: unknown
  tabId?: unknown
  source?: unknown
}): MessageHandler | null {
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
      return forgetReplayVideo
    default:
      return null
  }
}

export function registerInstantReplayListeners(): void {
  // Read from memory: a storage read every tick would keep the worker awake
  // even with instant replay off.
  let isEnabled = false
  chrome.storage.local
    .get(INSTANT_REPLAY_ENABLED_STORAGE_KEY)
    .then((result) => {
      isEnabled = result[INSTANT_REPLAY_ENABLED_STORAGE_KEY] === true
    })
    .catch(() => undefined)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    const change = changes[INSTANT_REPLAY_ENABLED_STORAGE_KEY]
    if (areaName !== "local" || !change) return
    isEnabled = change.newValue === true
    if (!isEnabled) {
      stopReplayVideo().catch((error: unknown) => {
        reportNonFatalError("Failed to stop the instant replay video", error)
      })
    }
  })
  // ponytail: keeps the worker alive while instant replay is on; persist the
  // recent logs to chrome.storage.session if Chrome stops honoring this.
  setInterval(() => {
    if (isEnabled) {
      chrome.runtime.getPlatformInfo().catch(() => undefined)
    }
  }, KEEP_AWAKE_INTERVAL_MS)

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (typeof message !== "object" || message === null) return
    const handler = getMessageHandler(message)
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
