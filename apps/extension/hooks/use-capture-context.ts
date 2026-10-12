import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useEffect, useState } from "react"
import {
  type CaptureContext,
  getActiveTabContext,
  hasCaptureContext,
  readAndClearStoredCaptureContext,
} from "@/lib/capture-context"
import { loadCaptureContext, saveCaptureContext } from "@/lib/recording-store"

// A review keeps the page it was captured on with the capture: opened again
// after a reload, the tab may show another page by then.
export function useCaptureContext(input: {
  sessionId: string | null
  isReview: boolean
}): CaptureContext {
  const { sessionId, isReview } = input
  const [captureContext, setCaptureContext] = useState<CaptureContext>({})

  useEffect(() => {
    const reviewSessionId = isReview ? sessionId : null
    const resolveContext = async (): Promise<CaptureContext> => {
      // Opened again: the page from the first time.
      const savedCaptureContext = reviewSessionId
        ? await loadCaptureContext(reviewSessionId)
        : null
      if (savedCaptureContext && hasCaptureContext(savedCaptureContext)) {
        return savedCaptureContext
      }

      const storedCaptureContext = await readAndClearStoredCaptureContext()
      const context = hasCaptureContext(storedCaptureContext)
        ? storedCaptureContext
        : await getActiveTabContext()
      if (reviewSessionId && hasCaptureContext(context)) {
        await saveCaptureContext(reviewSessionId, context)
      }
      return context
    }
    const loadContext = async () => {
      try {
        setCaptureContext(await resolveContext())
      } catch (error) {
        reportNonFatalError("Failed to load capture context", error)
        setCaptureContext({})
      }
    }

    loadContext()
  }, [isReview, sessionId])

  return captureContext
}
