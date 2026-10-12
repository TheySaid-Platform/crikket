import { readDebuggerSessionIdFromSearch } from "@crikket/capture-core/debugger/recorder-session"
import { useEffect, useRef } from "react"
import { REVIEW_QUERY_PARAM } from "@/lib/background-recording/protocol"
import {
  type FullPageDetails,
  loadRecording,
  loadScreenshot,
  type StoredRecording,
} from "@/lib/recording-store"

export type CaptureType = "video" | "screenshot"

interface UseRecorderInitProps {
  onCaptureTypeChange: (type: CaptureType) => void
  onScreenshotLoaded: (blob: Blob, fullPage: FullPageDetails | null) => void
  onRecordingLoaded: (recording: StoredRecording) => void
  onStartRecording: () => void
  onError: (error: string) => void
}

export function useRecorderInit({
  onCaptureTypeChange,
  onScreenshotLoaded,
  onRecordingLoaded,
  onStartRecording,
  onError,
}: UseRecorderInitProps) {
  const autoStartChecked = useRef(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const type = (params.get("captureType") as CaptureType) || "video"
    onCaptureTypeChange(type)

    if (type === "screenshot") {
      if (autoStartChecked.current) return
      autoStartChecked.current = true

      // Taken by the background worker, which stored it for this review.
      const sessionId = readDebuggerSessionIdFromSearch(window.location.search)
      loadScreenshot(sessionId ?? "")
        .then((screenshot) => {
          if (screenshot) {
            onScreenshotLoaded(screenshot.image, screenshot.fullPage)
          } else {
            onError("This screenshot is no longer available.")
          }
        })
        .catch((err) => {
          console.error("Failed to load screenshot:", err)
          onError("Failed to load screenshot")
        })
    } else if (type === "video") {
      if (autoStartChecked.current) return
      autoStartChecked.current = true

      // Recorded in the background: open the finished video for review.
      if (params.has(REVIEW_QUERY_PARAM)) {
        const sessionId = readDebuggerSessionIdFromSearch(
          window.location.search
        )
        loadRecording(sessionId ?? "")
          .then((recording) => {
            if (recording) {
              onRecordingLoaded(recording)
            } else {
              onError("This recording is no longer available.")
            }
          })
          .catch((err) => {
            console.error("Failed to load recording:", err)
            onError("Failed to load the recording")
          })
        return
      }

      chrome.storage.local.get(["startRecordingImmediately"], (result) => {
        if (result.startRecordingImmediately) {
          chrome.storage.local.remove(["startRecordingImmediately"])
          onStartRecording()
        }
      })
    }
  }, [
    onCaptureTypeChange,
    onScreenshotLoaded,
    onRecordingLoaded,
    onStartRecording,
    onError,
  ])
}
