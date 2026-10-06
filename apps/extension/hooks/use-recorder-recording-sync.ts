import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useEffect } from "react"
import type { CaptureType } from "@/hooks/use-recorder-init"
import {
  RECORDER_TAB_ID_STORAGE_KEY,
  RECORDING_COUNTDOWN_ENDS_AT_STORAGE_KEY,
  RECORDING_IN_PROGRESS_STORAGE_KEY,
  RECORDING_PAUSED_AT_STORAGE_KEY,
  RECORDING_STARTED_AT_STORAGE_KEY,
  setRecordingBadge,
  TOGGLE_RECORDING_PAUSE_MESSAGE,
} from "@/lib/capture-context"

interface UseRecorderRecordingSyncProps {
  captureType: CaptureType
  state: "idle" | "recording" | "stopped" | "submitting" | "success"
  startTime: number | null
  pausedAt: number | null
  onStopFromPopup: () => Promise<void>
  onTogglePause: () => void
}

export function useRecorderRecordingSync({
  captureType,
  onStopFromPopup,
  onTogglePause,
  pausedAt,
  startTime,
  state,
}: UseRecorderRecordingSyncProps) {
  useEffect(() => {
    // The flags belong to the tab that is recording. An old report tab or a
    // screenshot tab must not clear them, unless that tab is gone.
    const ownsRecordingFlags = async (): Promise<boolean> => {
      const stored = await chrome.storage.local.get(RECORDER_TAB_ID_STORAGE_KEY)
      const ownerTabId = stored[RECORDER_TAB_ID_STORAGE_KEY]
      if (typeof ownerTabId !== "number") {
        return true
      }

      const currentTab = await chrome.tabs.getCurrent()
      if (currentTab?.id === ownerTabId) {
        return true
      }

      return !(await chrome.tabs.get(ownerTabId).catch(() => null))
    }

    const clearRecordingFlags = async () => {
      if (!(await ownsRecordingFlags())) {
        return
      }

      await chrome.storage.local.set({
        [RECORDING_IN_PROGRESS_STORAGE_KEY]: false,
      })
      await chrome.storage.local.remove([
        RECORDER_TAB_ID_STORAGE_KEY,
        RECORDING_COUNTDOWN_ENDS_AT_STORAGE_KEY,
        RECORDING_STARTED_AT_STORAGE_KEY,
        RECORDING_PAUSED_AT_STORAGE_KEY,
      ])
      await setRecordingBadge(null)
    }

    const syncRecordingState = async () => {
      if (captureType !== "video") {
        await clearRecordingFlags()
        return
      }

      if (state === "idle") {
        const result = await chrome.storage.local.get([
          RECORDING_IN_PROGRESS_STORAGE_KEY,
          RECORDING_COUNTDOWN_ENDS_AT_STORAGE_KEY,
        ])
        const isRecordingInProgress = Boolean(
          result[RECORDING_IN_PROGRESS_STORAGE_KEY]
        )
        const hasActiveCountdown =
          typeof result[RECORDING_COUNTDOWN_ENDS_AT_STORAGE_KEY] === "number"

        if (isRecordingInProgress && !hasActiveCountdown) {
          await clearRecordingFlags()
        }
        return
      }

      if (state === "recording") {
        const currentTab = await chrome.tabs.getCurrent()
        await chrome.storage.local.set({
          [RECORDING_IN_PROGRESS_STORAGE_KEY]: true,
          [RECORDING_STARTED_AT_STORAGE_KEY]: startTime ?? Date.now(),
          [RECORDING_PAUSED_AT_STORAGE_KEY]: pausedAt,
          [RECORDER_TAB_ID_STORAGE_KEY]: currentTab?.id,
        })
        await chrome.storage.local.remove([
          RECORDING_COUNTDOWN_ENDS_AT_STORAGE_KEY,
        ])
        await setRecordingBadge(pausedAt === null ? "recording" : "paused")
        return
      }

      await clearRecordingFlags()
    }

    syncRecordingState().catch((error: unknown) => {
      reportNonFatalError("Failed to sync recorder recording state", error)
    })
  }, [captureType, pausedAt, startTime, state])

  useEffect(() => {
    const handleMessage = (
      message: { type?: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: { ok: boolean }) => void
    ) => {
      if (state !== "recording") return
      if (message.type === TOGGLE_RECORDING_PAUSE_MESSAGE) {
        onTogglePause()
        // Lets the popup tell a paused recording from a missing recorder.
        sendResponse({ ok: true })
        return
      }
      if (message.type !== "STOP_RECORDING_FROM_POPUP") return
      onStopFromPopup().catch((error: unknown) => {
        reportNonFatalError(
          "Failed to stop recording from popup trigger",
          error
        )
      })
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [onStopFromPopup, onTogglePause, state])

  useEffect(() => {
    return () => {
      chrome.storage.local.set({
        [RECORDING_IN_PROGRESS_STORAGE_KEY]: false,
      })
      chrome.storage.local.remove([
        RECORDER_TAB_ID_STORAGE_KEY,
        RECORDING_COUNTDOWN_ENDS_AT_STORAGE_KEY,
        RECORDING_STARTED_AT_STORAGE_KEY,
        RECORDING_PAUSED_AT_STORAGE_KEY,
      ])
      setRecordingBadge(null)
    }
  }, [])
}
