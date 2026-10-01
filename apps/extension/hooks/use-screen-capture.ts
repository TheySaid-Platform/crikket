import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useCallback, useRef, useState } from "react"
import {
  readAndClearCaptureTabId,
  type VideoSource,
} from "@/lib/capture-context"
import {
  requestDisplayCaptureStream,
  requestTabCaptureStream,
  stopCaptureStream,
} from "@/lib/display-media"

export interface UseScreenCaptureReturn {
  isRecording: boolean
  recordedBlob: Blob | null
  screenshotBlob: Blob | null
  error: string | null
  startRecording: (source?: VideoSource) => Promise<boolean>
  stopRecording: () => Promise<Blob | null>
  takeScreenshot: () => Promise<Blob | null>
  reset: () => void
  setRecordedBlob: (blob: Blob | null) => void
  setScreenshotBlob: (blob: Blob | null) => void
}

export function useScreenCapture(): UseScreenCaptureReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  // Kept after the first read so a cancelled window picker can be retried.
  const captureTabIdRef = useRef<number | null>(null)

  const startRecording = useCallback(
    async (source: VideoSource = "tab"): Promise<boolean> => {
      try {
        setError(null)
        setRecordedBlob(null)

        const captureTabId =
          captureTabIdRef.current ?? (await readAndClearCaptureTabId())
        captureTabIdRef.current = captureTabId
        if (!captureTabId && source === "tab") {
          throw new Error(
            "Could not lock the source tab. Please start recording from the extension popup."
          )
        }

        const stream =
          source === "display"
            ? await requestDisplayCaptureStream()
            : await requestTabCaptureStream(captureTabId as number)

        // The picker left the user on this recorder tab; take them back to the
        // page they want to record before the first frames land.
        if (source === "display" && captureTabId) {
          await returnToTab(captureTabId)
        }

        streamRef.current = stream

        const preferredMimeTypes = [
          "video/webm;codecs=vp9,opus",
          "video/webm;codecs=vp8,opus",
          "video/webm;codecs=opus",
          "video/webm",
        ]
        const mimeType =
          preferredMimeTypes.find((type) =>
            MediaRecorder.isTypeSupported(type)
          ) ?? ""
        const mediaRecorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined
        )

        mediaRecorderRef.current = mediaRecorder
        chunksRef.current = []

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data)
          }
        }

        mediaRecorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "video/webm" })
          setRecordedBlob(blob)
          setIsRecording(false)
          stopCaptureStream(stream)
        }
        stream.getVideoTracks()[0].onended = () => {
          if (mediaRecorderRef.current?.state === "recording") {
            mediaRecorderRef.current.stop()
          }
        }

        mediaRecorder.start(1000)
        setIsRecording(true)
        return true
      } catch (err) {
        setError(getStartRecordingErrorMessage(err, source))
        setIsRecording(false)
        return false
      }
    },
    []
  )

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (
        !mediaRecorderRef.current ||
        mediaRecorderRef.current.state !== "recording"
      ) {
        resolve(null)
        return
      }

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" })
        setRecordedBlob(blob)
        setIsRecording(false)

        if (streamRef.current) {
          stopCaptureStream(streamRef.current)
        }

        resolve(blob)
      }

      mediaRecorderRef.current.stop()
    })
  }, [])

  const takeScreenshot = useCallback(async (): Promise<Blob | null> => {
    try {
      setError(null)
      setScreenshotBlob(null)

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "browser",
        },
        audio: false,
      })

      const videoTrack = stream.getVideoTracks()[0]
      const settings = videoTrack.getSettings()

      const video = document.createElement("video")
      video.srcObject = stream
      video.autoplay = true

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play()
          resolve()
        }
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      const canvas = document.createElement("canvas")
      canvas.width = settings.width || video.videoWidth
      canvas.height = settings.height || video.videoHeight

      const ctx = canvas.getContext("2d")
      if (!ctx) {
        throw new Error("Could not get canvas context")
      }

      ctx.drawImage(video, 0, 0)

      for (const track of stream.getTracks()) {
        track.stop()
      }
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          setScreenshotBlob(blob)
          resolve(blob)
        }, "image/png")
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to take screenshot"
      setError(message)
      return null
    }
  }, [])

  const reset = useCallback(() => {
    setRecordedBlob(null)
    setScreenshotBlob(null)
    setError(null)
    setIsRecording(false)

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) {
      stopCaptureStream(streamRef.current)
    }
  }, [])

  return {
    isRecording,
    recordedBlob,
    screenshotBlob,
    error,
    startRecording,
    stopRecording,
    takeScreenshot,
    reset,
    setRecordedBlob,
    setScreenshotBlob,
  }
}

const TAB_SWITCH_SETTLE_MS = 300

async function returnToTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true })
    if (typeof tab?.windowId === "number") {
      await chrome.windows.update(tab.windowId, { focused: true })
    }
    await new Promise((resolve) => setTimeout(resolve, TAB_SWITCH_SETTLE_MS))
  } catch (error) {
    // The tab may have been closed; recording the window still works.
    reportNonFatalError(`Failed to return to capture tab ${tabId}`, error)
  }
}

function getStartRecordingErrorMessage(
  error: unknown,
  source: VideoSource
): string {
  if (
    source === "display" &&
    error instanceof DOMException &&
    error.name === "NotAllowedError"
  ) {
    return "Screen sharing was cancelled. Share your screen to start recording."
  }

  return error instanceof Error ? error.message : "Failed to start recording"
}
