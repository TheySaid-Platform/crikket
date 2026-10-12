import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useCallback, useMemo } from "react"
import { closeRecorderWindow } from "@/lib/background-recording/client"
import {
  BACKGROUND_RECORDING_MESSAGE,
  REVIEW_QUERY_PARAM,
} from "@/lib/background-recording/protocol"
import { deleteRecording } from "@/lib/recording-store"

// For a capture made in the background: its video waits in IndexedDB until
// the report is sent or dropped.
export function useReviewRecording(debuggerSessionId: string | null) {
  const isReview = useMemo(
    () => new URLSearchParams(window.location.search).has(REVIEW_QUERY_PARAM),
    []
  )

  const forgetRecording = useCallback(() => {
    if (!(isReview && debuggerSessionId)) return
    deleteRecording(debuggerSessionId).catch((error: unknown) => {
      reportNonFatalError("Failed to delete the reviewed recording", error)
    })
    // The popup stops offering to open it again.
    chrome.runtime
      .sendMessage({
        type: BACKGROUND_RECORDING_MESSAGE.reviewDone,
        debuggerSessionId,
      })
      .catch((error: unknown) => {
        reportNonFatalError("Failed to mark the review as done", error)
      })
  }, [debuggerSessionId, isReview])

  // Cancel closes the review, since there is nothing left to record here.
  const cancelReview = useCallback(() => {
    if (!isReview) return
    forgetRecording()
    closeRecorderWindow()
  }, [forgetRecording, isReview])

  return { isReview, forgetRecording, cancelReview }
}
