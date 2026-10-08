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
  markDebuggerRecordingStarted,
  markDebuggerRecordingStopped,
} from "@/lib/bug-report-debugger/client"
import {
  getMicrophoneTrack,
  openTabCaptureStream,
  openTabVideoStream,
  requestDisplayCaptureStream,
  requestDisplayVideoStream,
  stopCaptureStream,
} from "@/lib/display-media"
import {
  INSTANT_REPLAY_MESSAGE,
  INSTANT_REPLAY_WINDOW_MS,
} from "@/lib/instant-replay/protocol"
import {
  createVideoReplayBuffer,
  type VideoClip,
  type VideoReplayBuffer,
} from "@/lib/instant-replay/video-buffer"
import { createWebmRecorder } from "@/lib/media-recorder"
import { createMicLevelMeter, type MicLevelMeter } from "@/lib/mic-level-meter"
import { saveRecording } from "@/lib/recording-store"

// Offscreen documents only get chrome.runtime, so the background worker does
// the rest and talks to this page through messages.

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
  // On failure the background decides what happens to the debugger session:
  // the popup may go on with it in the recorder tab.
  const stream = await openStream(request)
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

  // The tab closed or "Stop sharing" was clicked: stop as usual.
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

// Instant replay's video, kept apart from a recording.
let replayVideo: VideoReplayBuffer | null = null
// A clip cut by "replay-video-save", waiting for its debugger session id.
let savedClip: VideoClip | null = null

function stopReplayVideo(): void {
  replayVideo?.stop()
  replayVideo = null
  savedClip = null
}

// The tab closed, sharing was stopped, or encoding failed.
function endReplayVideo(): void {
  stopReplayVideo()
  chrome.runtime
    .sendMessage({ type: INSTANT_REPLAY_MESSAGE.videoEnded })
    .catch((error: unknown) => {
      reportNonFatalError("Failed to report the end of the replay video", error)
    })
}

type ReplayVideoStartRequest = Extract<
  OffscreenRequest,
  { type: "replay-video-start" }
>

async function startReplayVideo(
  request: ReplayVideoStartRequest
): Promise<OffscreenResponse> {
  stopReplayVideo()
  const stream =
    request.source === "tab"
      ? await openTabVideoStream(request.streamId)
      : await requestDisplayVideoStream()
  const [track] = stream.getVideoTracks()
  const buffer = createVideoReplayBuffer(
    track,
    INSTANT_REPLAY_WINDOW_MS,
    (error) => {
      reportNonFatalError("Instant replay video failed", error)
      if (replayVideo === buffer) endReplayVideo()
    }
  )
  replayVideo = buffer
  track.onended = () => {
    if (replayVideo === buffer) endReplayVideo()
  }
  return { ok: true, startedAt: Date.now() }
}

async function saveReplayVideo(): Promise<OffscreenResponse> {
  savedClip = (await replayVideo?.save()) ?? null
  if (!savedClip) {
    return { ok: false, error: "There is no video to save yet." }
  }
  return { ok: true, startedAt: savedClip.startedAt, at: savedClip.stoppedAt }
}

async function storeReplayVideo(
  debuggerSessionId: string
): Promise<OffscreenResponse> {
  const clip = savedClip
  savedClip = null
  if (!clip) {
    return { ok: false, error: "The video clip is gone. Save it again." }
  }
  await saveRecording(debuggerSessionId, {
    blob: clip.blob,
    durationMs: clip.stoppedAt - clip.startedAt,
    startedAt: clip.startedAt,
    stoppedAt: clip.stoppedAt,
    pauses: [],
  })
  return { ok: true }
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
    case "replay-video-start":
      return await startReplayVideo(request)
    case "replay-video-stop":
      stopReplayVideo()
      return { ok: true }
    case "replay-video-save":
      return await saveReplayVideo()
    case "replay-video-store":
      return await storeReplayVideo(request.debuggerSessionId)
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
