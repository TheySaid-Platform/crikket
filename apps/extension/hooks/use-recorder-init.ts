import { readDebuggerSessionIdFromSearch } from "@crikket/capture-core/debugger/recorder-session"
import { useEffect, useRef } from "react"
import { REVIEW_QUERY_PARAM } from "@/lib/background-recording/protocol"
import {
  type FullPageDetails,
  loadRecording,
  loadReplay,
  loadScreenshot,
  type StoredRecording,
  type StoredReplay,
} from "@/lib/recording-store"

export type CaptureType = "video" | "screenshot" | "replay"

interface UseRecorderInitProps {
  onCaptureTypeChange: (type: CaptureType) => void
  onScreenshotLoaded: (blob: Blob, fullPage: FullPageDetails | null) => void
  onRecordingLoaded: (recording: StoredRecording) => void
  onReplayLoaded: (replay: StoredReplay) => void
  onStartRecording: () => void
  onError: (error: string) => void
}

// Taken by the background worker, which stored it for this review.
function loadScreenshotForReview(input: {
  onLoaded: (blob: Blob, fullPage: FullPageDetails | null) => void
  onError: (error: string) => void
}): void {
  const sessionId = readDebuggerSessionIdFromSearch(window.location.search)
  loadScreenshot(sessionId ?? "")
    .then((screenshot) => {
      if (screenshot) {
        input.onLoaded(screenshot.image, screenshot.fullPage)
      } else {
        input.onError("This screenshot is no longer available.")
      }
    })
    .catch((err) => {
      console.error("Failed to load screenshot:", err)
      input.onError("Failed to load screenshot")
    })
}

// Saved by the background from the page's instant replay.
function loadReplayForReview(input: {
  onLoaded: (replay: StoredReplay) => void
  onError: (error: string) => void
}): void {
  const sessionId = readDebuggerSessionIdFromSearch(window.location.search)
  loadReplay(sessionId ?? "")
    .then((replay) => {
      if (replay) {
        input.onLoaded(replay)
      } else {
        input.onError("This replay is no longer available.")
      }
    })
    .catch((err) => {
      console.error("Failed to load replay:", err)
      input.onError("Failed to load the replay")
    })
}

export function useRecorderInit({
  onCaptureTypeChange,
  onScreenshotLoaded,
  onRecordingLoaded,
  onReplayLoaded,
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
      loadScreenshotForReview({ onLoaded: onScreenshotLoaded, onError })
    } else if (type === "replay") {
      if (autoStartChecked.current) return
      autoStartChecked.current = true
      loadReplayForReview({ onLoaded: onReplayLoaded, onError })
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
    onReplayLoaded,
    onStartRecording,
    onError,
  ])
}
