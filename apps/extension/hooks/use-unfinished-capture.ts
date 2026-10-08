import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useCallback, useEffect, useState } from "react"
import {
  BACKGROUND_RECORDING_MESSAGE,
  PENDING_REVIEW_STORAGE_KEY,
  type PendingReview,
  RECORDING_ERROR_STORAGE_KEY,
} from "@/lib/background-recording/protocol"
import { setRecordingBadge } from "@/lib/capture-context"

// For the popup: the review not sent yet, and why the last recording failed.
export function useUnfinishedCapture() {
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null)
  const [recordingError, setRecordingError] = useState<string | null>(null)

  useEffect(() => {
    const read = async () => {
      const result = await chrome.storage.local.get([
        PENDING_REVIEW_STORAGE_KEY,
        RECORDING_ERROR_STORAGE_KEY,
      ])
      setPendingReview(
        (result[PENDING_REVIEW_STORAGE_KEY] as PendingReview | undefined) ??
          null
      )
      const error = result[RECORDING_ERROR_STORAGE_KEY]
      if (typeof error !== "string") return
      setRecordingError(error)
      await chrome.storage.local.remove(RECORDING_ERROR_STORAGE_KEY)
      // The "!" on the toolbar icon pointed here.
      if ((await chrome.action.getBadgeText({})) === "!") {
        await setRecordingBadge(null)
      }
    }
    read().catch((error: unknown) => {
      reportNonFatalError("Failed to read the unfinished capture", error)
    })
  }, [])

  const reopenReview = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: BACKGROUND_RECORDING_MESSAGE.reopenReview,
      })
      window.close()
    } catch (error) {
      reportNonFatalError("Failed to open the unsent report", error)
    }
  }, [])

  return { pendingReview, recordingError, reopenReview }
}
