interface TabCaptureMandatory {
  chromeMediaSource: "tab"
  chromeMediaSourceId: string
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  maxFrameRate?: number
}

interface TabCaptureConstraints extends MediaTrackConstraints {
  mandatory?: TabCaptureMandatory
}

// Chrome-only getDisplayMedia options missing from TypeScript's DOM types.
interface ChromeDisplayMediaStreamOptions extends DisplayMediaStreamOptions {
  selfBrowserSurface?: "include" | "exclude"
  surfaceSwitching?: "include" | "exclude"
  systemAudio?: "include" | "exclude"
  monitorTypeSurfaces?: "include" | "exclude"
}

// Everything a recording stream holds open, so stopping it also releases the
// mic and any captured system audio.
const cleanupByStream = new WeakMap<MediaStream, () => void>()

// The raw microphone behind a recording stream. Toggling its `enabled` flag
// mutes or unmutes narration without touching the tab or screen audio.
const micTrackByStream = new WeakMap<MediaStream, MediaStreamTrack>()

export const getMicrophoneTrack = (
  stream: MediaStream
): MediaStreamTrack | null => micTrackByStream.get(stream) ?? null

export const requestTabCaptureStream = async (
  tabId: number
): Promise<MediaStream> => {
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId,
  })

  return openTabCaptureStream(streamId)
}

// Opens a tab capture from a stream id. Split out so the offscreen recorder,
// which cannot call chrome.tabCapture itself, can use an id the background
// worker created.
export const openTabCaptureStream = async (
  streamId: string
): Promise<MediaStream> => {
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as TabCaptureConstraints,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        minWidth: 1280,
        maxWidth: 1920,
        minHeight: 720,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    } as TabCaptureConstraints,
  })

  // Tab capture mutes the tab, so play its audio back to the user.
  return mixWithMicrophone(tabStream, { playBackSourceAudio: true })
}

// Records the screen (or a window, if the user picks one), so the video follows
// them across tabs and popup windows. Must be called from a click in an
// extension page.
export const requestDisplayCaptureStream = async (): Promise<MediaStream> => {
  const options: ChromeDisplayMediaStreamOptions = {
    video: {
      // Opens Chrome's picker on "Entire screen".
      displaySurface: "monitor",
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { max: 30 },
    },
    audio: true,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: "include",
    monitorTypeSurfaces: "include",
  }
  const displayStream = await navigator.mediaDevices.getDisplayMedia(options)

  return mixWithMicrophone(displayStream, { playBackSourceAudio: false })
}

// Instant replay's video: picture only, so the tab keeps its sound and nothing
// asks for the microphone. 15 fps halves the cost of encoding all the time.
const REPLAY_VIDEO_MAX_FRAME_RATE = 15

export const openTabVideoStream = (streamId: string): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: REPLAY_VIDEO_MAX_FRAME_RATE,
      },
    } as TabCaptureConstraints,
  })

export const requestDisplayVideoStream = (): Promise<MediaStream> => {
  const options: ChromeDisplayMediaStreamOptions = {
    video: {
      displaySurface: "monitor",
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { max: REPLAY_VIDEO_MAX_FRAME_RATE },
    },
    audio: false,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    monitorTypeSurfaces: "include",
  }
  return navigator.mediaDevices.getDisplayMedia(options)
}

export const stopCaptureStream = (stream: MediaStream): void => {
  for (const track of stream.getTracks()) {
    track.stop()
  }

  cleanupByStream.get(stream)?.()
  cleanupByStream.delete(stream)
  micTrackByStream.delete(stream)
}

const mixWithMicrophone = async (
  sourceStream: MediaStream,
  options: { playBackSourceAudio: boolean }
): Promise<MediaStream> => {
  let micStream: MediaStream | null = null
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    })
  } catch {
    // Mic is optional. If the user denies the prompt or no input device is
    // available, we still record source audio + video.
  }

  const audioContext = new AudioContext()
  if (!(await startAudioContext(audioContext))) {
    audioContext.close().catch(() => undefined)
    return recordWithoutMixing(sourceStream, micStream)
  }

  const mixDestination = audioContext.createMediaStreamDestination()

  // Window and screen capture often come without audio.
  if (sourceStream.getAudioTracks().length > 0) {
    const sourceAudio = audioContext.createMediaStreamSource(sourceStream)
    sourceAudio.connect(mixDestination)
    if (options.playBackSourceAudio) {
      sourceAudio.connect(audioContext.destination)
    }
  }

  if (micStream) {
    audioContext.createMediaStreamSource(micStream).connect(mixDestination)
  }

  const stream = new MediaStream([
    sourceStream.getVideoTracks()[0],
    mixDestination.stream.getAudioTracks()[0],
  ])

  cleanupByStream.set(stream, () => {
    for (const track of [
      ...sourceStream.getTracks(),
      ...(micStream?.getTracks() ?? []),
    ]) {
      track.stop()
    }
    audioContext.close().catch(() => undefined)
  })

  const micTrack = micStream?.getAudioTracks()[0]
  if (micTrack) {
    micTrackByStream.set(stream, micTrack)
  }

  return stream
}

// Chrome keeps an AudioContext suspended until the page is clicked, unless the
// page already had microphone permission when it loaded. The recorder tab
// starts on its own, so on a first recording (or with the mic blocked) the mix
// would record silence. resume() never settles without permission to play,
// hence the timeout.
const AUDIO_CONTEXT_START_TIMEOUT_MS = 500

const isRunning = (audioContext: AudioContext): boolean =>
  audioContext.state === "running"

const startAudioContext = async (
  audioContext: AudioContext
): Promise<boolean> => {
  if (isRunning(audioContext)) return true

  await Promise.race([
    audioContext.resume().catch(() => undefined),
    new Promise((resolve) =>
      setTimeout(resolve, AUDIO_CONTEXT_START_TIMEOUT_MS)
    ),
  ])
  return isRunning(audioContext)
}

// Without a running AudioContext the two audio sources can't be mixed, and
// MediaRecorder keeps only one audio track, so record the narration if there
// is one and the tab or screen audio otherwise.
const recordWithoutMixing = (
  sourceStream: MediaStream,
  micStream: MediaStream | null
): MediaStream => {
  const micTrack = micStream?.getAudioTracks()[0]
  const audioTrack = micTrack ?? sourceStream.getAudioTracks()[0]
  const stream = new MediaStream([
    sourceStream.getVideoTracks()[0],
    ...(audioTrack ? [audioTrack] : []),
  ])

  cleanupByStream.set(stream, () => {
    for (const track of [
      ...sourceStream.getTracks(),
      ...(micStream?.getTracks() ?? []),
    ]) {
      track.stop()
    }
  })

  if (micTrack) {
    micTrackByStream.set(stream, micTrack)
  }

  return stream
}
