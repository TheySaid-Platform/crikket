import type { RecordingPause } from "@crikket/capture-core/debugger/types"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import {
  BACKGROUND_RECORDING_MESSAGE,
  MIC_LEVEL_PORT_NAME,
  OFFSCREEN_MESSAGE_TARGET,
  type OffscreenRequest,
  type OffscreenResponse,
} from "@/lib/background-recording/protocol"
import {
  discardDebuggerSession,
  markDebuggerRecordingStarted,
  markDebuggerRecordingStopped,
} from "@/lib/bug-report-debugger/client"
import {
  getMicrophoneTrack,
  openTabCaptureStream,
  requestDisplayCaptureStream,
  stopCaptureStream,
} from "@/lib/display-media"
import { createWebmRecorder } from "@/lib/media-recorder"
import { createMicLevelMeter, type MicLevelMeter } from "@/lib/mic-level-meter"
import { saveRecording } from "@/lib/recording-store"

// Records "Record This Tab" and "Record Full Screen" without a visible tab.
// Offscreen documents only get chrome.runtime, so the background worker does
// everything else and talks to this page through messages.

interface ActiveRecording {
  recorder: MediaRecorder
  stream: MediaStream
  chunks: Blob[]
  debuggerSessionId: string
  startedAt: number
  pausedAt: number | null
  pauses: RecordingPause[]
  micTrack: MediaStreamTrack | null
  micMeter: MicLevelMeter | null
}

let active: ActiveRecording | null = null

// Floating bars listening for the mic level, one per page showing the bar.
const MIC_LEVEL_INTERVAL_MS = 100
const micLevelPorts = new Set<chrome.runtime.Port>()

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== MIC_LEVEL_PORT_NAME) return
  micLevelPorts.add(port)
  port.onDisconnect.addListener(() => micLevelPorts.delete(port))
})

setInterval(() => {
  const meter = active?.micMeter
  if (!meter || micLevelPorts.size === 0) return
  const level = meter.read()
  for (const port of micLevelPorts) {
    port.postMessage({ level })
  }
}, MIC_LEVEL_INTERVAL_MS)

type StartRequest = Extract<OffscreenRequest, { type: "start" }>

// A tab is captured from the stream id the background created; the screen is
// picked here, in Chrome's own share dialog.
function openStream(request: StartRequest): Promise<MediaStream> {
  return request.source === "tab"
    ? openTabCaptureStream(request.streamId)
    : requestDisplayCaptureStream()
}

async function start(request: StartRequest): Promise<OffscreenResponse> {
  if (active) {
    return { ok: false, error: "A recording is already running." }
  }

  const { debuggerSessionId } = request
  let stream: MediaStream
  try {
    stream = await openStream(request)
  } catch (error) {
    // The popup usually closes while Chrome's screen picker is open, so it
    // cannot clean up; drop the debugger session here instead.
    await discardDebuggerSession(debuggerSessionId).catch(
      (discardError: unknown) => {
        reportNonFatalError(
          `Failed to discard debugger session ${debuggerSessionId}`,
          discardError
        )
      }
    )
    throw error
  }
  const recorder = createWebmRecorder(stream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }

  const micTrack = getMicrophoneTrack(stream)
  recorder.start(1000)
  const startedAt = Date.now()
  active = {
    recorder,
    stream,
    chunks,
    debuggerSessionId,
    startedAt,
    pausedAt: null,
    pauses: [],
    micTrack,
    micMeter: micTrack ? createMicLevelMeter(micTrack) : null,
  }

  // The recorded tab was closed or Chrome's "Stop sharing" was clicked:
  // finish the recording like a normal stop.
  stream.getVideoTracks()[0].onended = () => {
    chrome.runtime
      .sendMessage({ type: BACKGROUND_RECORDING_MESSAGE.ended })
      .catch((error: unknown) => {
        reportNonFatalError("Failed to report the end of a capture", error)
      })
  }

  await markDebuggerRecordingStarted({
    sessionId: debuggerSessionId,
    recordingStartedAt: startedAt,
  }).catch((error: unknown) => {
    reportNonFatalError(
      `Failed to mark debugger recording start for session ${debuggerSessionId}`,
      error
    )
  })

  return { ok: true, startedAt, micState: micTrack ? "on" : "unavailable" }
}

function stopRecorder(recorder: MediaRecorder): Promise<void> {
  if (recorder.state === "inactive") {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    recorder.onstop = () => resolve()
    recorder.stop()
  })
}

async function stop(): Promise<OffscreenResponse> {
  const recording = active
  if (!recording) {
    return { ok: false, error: "No recording is running." }
  }
  active = null

  const stoppedAt = Date.now()
  // Stopping while paused ends the video where the pause began.
  if (recording.pausedAt !== null) {
    recording.pauses.push({
      pausedAt: recording.pausedAt,
      resumedAt: stoppedAt,
    })
  }

  await stopRecorder(recording.recorder)
  recording.micMeter?.stop()
  stopCaptureStream(recording.stream)

  const sessionId = recording.debuggerSessionId
  await markDebuggerRecordingStopped({
    sessionId,
    recordingStoppedAt: stoppedAt,
  }).catch((error: unknown) => {
    reportNonFatalError(
      `Failed to mark debugger recording stop for session ${sessionId}`,
      error
    )
  })

  const pausedMs = recording.pauses.reduce(
    (total, pause) => total + (pause.resumedAt - pause.pausedAt),
    0
  )
  await saveRecording(sessionId, {
    blob: new Blob(recording.chunks, { type: "video/webm" }),
    durationMs: Math.max(0, stoppedAt - recording.startedAt - pausedMs),
    startedAt: recording.startedAt,
    stoppedAt,
    pauses: recording.pauses,
  })

  return { ok: true, at: stoppedAt }
}

function pause(): OffscreenResponse {
  if (!active || active.pausedAt !== null) {
    return { ok: false, error: "Nothing to pause." }
  }
  active.recorder.pause()
  active.pausedAt = Date.now()
  return { ok: true, at: active.pausedAt }
}

function resume(): OffscreenResponse {
  if (!active || active.pausedAt === null) {
    return { ok: false, error: "Nothing to resume." }
  }
  const now = Date.now()
  active.pauses.push({ pausedAt: active.pausedAt, resumedAt: now })
  active.pausedAt = null
  active.recorder.resume()
  return { ok: true, at: now }
}

function toggleMic(): OffscreenResponse {
  const micTrack = active?.micTrack
  if (!micTrack) {
    return { ok: true, micState: "unavailable" }
  }
  micTrack.enabled = !micTrack.enabled
  return { ok: true, micState: micTrack.enabled ? "on" : "off" }
}

async function handle(request: OffscreenRequest): Promise<OffscreenResponse> {
  switch (request.type) {
    case "start":
      return await start(request)
    case "stop":
      return await stop()
    case "pause":
      return pause()
    case "resume":
      return resume()
    case "toggle-mic":
      return toggleMic()
    default:
      return { ok: false, error: "Unknown recorder request." }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== OFFSCREEN_MESSAGE_TARGET) {
    return
  }

  handle(message.request as OffscreenRequest).then(sendResponse, (error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Recording failed.",
      errorName: error instanceof Error ? error.name : undefined,
    } satisfies OffscreenResponse)
  })
  return true
})
