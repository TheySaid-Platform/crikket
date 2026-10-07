import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useCallback, useMemo } from "react"
import { closeRecorderWindow } from "@/lib/background-recording/client"
import { REVIEW_QUERY_PARAM } from "@/lib/background-recording/protocol"
import { deleteRecording } from "@/lib/recording-store"

/**
 * For a recording made in the background (no recorder tab): this page only
 * reviews it. The video waits in IndexedDB until the report is sent or
 * cancelled.
 */
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
  }, [debuggerSessionId, isReview])

  // Cancel closes the review, since there is nothing left to record here.
  const cancelReview = useCallback(() => {
    if (!isReview) return
    forgetRecording()
    closeRecorderWindow()
  }, [forgetRecording, isReview])

  return { isReview, forgetRecording, cancelReview }
}
