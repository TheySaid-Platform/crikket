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

export const requestTabCaptureStream = async (
  tabId: number
): Promise<MediaStream> => {
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId,
  })

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

export const stopCaptureStream = (stream: MediaStream): void => {
  for (const track of stream.getTracks()) {
    track.stop()
  }

  cleanupByStream.get(stream)?.()
  cleanupByStream.delete(stream)
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

  return stream
}
