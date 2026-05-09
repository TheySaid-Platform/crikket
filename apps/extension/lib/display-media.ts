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

  let micStream: MediaStream | null = null
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    })
  } catch {
    // Mic is optional. If the user denies the prompt or no input device is
    // available, we still record tab audio + video.
  }

  const audioContext = new AudioContext()
  const mixDestination = audioContext.createMediaStreamDestination()

  const tabAudioSource = audioContext.createMediaStreamSource(tabStream)
  tabAudioSource.connect(mixDestination)
  // Audible loopback so the user keeps hearing the tab while it records.
  tabAudioSource.connect(audioContext.destination)

  if (micStream) {
    audioContext.createMediaStreamSource(micStream).connect(mixDestination)
  }

  return new MediaStream([
    tabStream.getVideoTracks()[0],
    mixDestination.stream.getAudioTracks()[0],
  ])
}
