import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useEffect, useRef } from "react"
import {
  loadCaptureEdits,
  type SavedCaptureEdits,
  saveCaptureEdits,
} from "@/lib/recording-store"

const SAVE_DELAY_MS = 300

const hasEdits = (edits: SavedCaptureEdits) =>
  edits.videoEdits !== null ||
  edits.screenshotEdits !== null ||
  edits.editedScreenshot !== null

// A review can open again after its page reloads. Its trim, blur and drawings
// are kept with the capture, so a blur is never lost without the user seeing.
export function useSavedReviewEdits(input: {
  sessionId: string | null
  isReview: boolean
  edits: SavedCaptureEdits
  onRestore: (edits: SavedCaptureEdits) => void
}) {
  const { sessionId, isReview, edits, onRestore } = input
  const isRestoredRef = useRef(false)
  const editsRef = useRef(edits)
  editsRef.current = edits

  useEffect(() => {
    if (!(isReview && sessionId)) return
    let cancelled = false
    loadCaptureEdits(sessionId)
      .then((saved) => {
        // Edits the user made in the meantime win.
        if (!cancelled && saved && !hasEdits(editsRef.current)) {
          onRestore(saved)
        }
      })
      .catch((error: unknown) => {
        reportNonFatalError("Failed to load the saved edits", error)
      })
      .finally(() => {
        isRestoredRef.current = true
      })
    return () => {
      cancelled = true
    }
  }, [isReview, onRestore, sessionId])

  const { videoEdits, screenshotEdits, editedScreenshot } = edits
  useEffect(() => {
    if (!(isReview && sessionId && isRestoredRef.current)) return
    const timer = setTimeout(() => {
      const current = { videoEdits, screenshotEdits, editedScreenshot }
      saveCaptureEdits(sessionId, hasEdits(current) ? current : null).catch(
        (error: unknown) => {
          reportNonFatalError("Failed to save the edits", error)
        }
      )
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [editedScreenshot, isReview, screenshotEdits, sessionId, videoEdits])
}
