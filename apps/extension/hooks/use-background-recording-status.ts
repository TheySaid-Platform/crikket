import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useEffect, useState } from "react"
import {
  BACKGROUND_RECORDING_STORAGE_KEY,
  type BackgroundRecordingState,
  getRecordedMs,
} from "@/lib/background-recording/protocol"

const TICK_MS = 250

/** The background "Record This Tab" recording, for the popup to show. */
export function useBackgroundRecordingStatus() {
  const [backgroundRecording, setBackgroundRecording] =
    useState<BackgroundRecordingState | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    chrome.storage.local
      .get(BACKGROUND_RECORDING_STORAGE_KEY)
      .then((result) => {
        setBackgroundRecording(
          (result[BACKGROUND_RECORDING_STORAGE_KEY] as
            | BackgroundRecordingState
            | undefined) ?? null
        )
      })
      .catch((error: unknown) => {
        reportNonFatalError("Failed to read the tab recording state", error)
      })

    const handleChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      const change = changes[BACKGROUND_RECORDING_STORAGE_KEY]
      if (areaName !== "local" || !change) return
      setBackgroundRecording(
        (change.newValue as BackgroundRecordingState | undefined) ?? null
      )
    }
    chrome.storage.onChanged.addListener(handleChange)
    return () => chrome.storage.onChanged.removeListener(handleChange)
  }, [])

  useEffect(() => {
    if (!backgroundRecording) return
    const intervalId = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(intervalId)
  }, [backgroundRecording])

  return {
    backgroundRecording,
    backgroundRecordedMs: backgroundRecording
      ? getRecordedMs(backgroundRecording, now)
      : 0,
  }
}
