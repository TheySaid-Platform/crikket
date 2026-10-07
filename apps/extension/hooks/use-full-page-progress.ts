import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useEffect, useState } from "react"
import { FULL_PAGE_CAPTURE_STORAGE_KEY } from "@/lib/background-recording/protocol"
import type { FullPageProgress } from "@/lib/full-page-screenshot"

const readProgress = (value: unknown): FullPageProgress | null => {
  const progress = value as Partial<FullPageProgress> | undefined
  return typeof progress?.screensDone === "number" &&
    typeof progress.screensTotal === "number"
    ? { screensDone: progress.screensDone, screensTotal: progress.screensTotal }
    : null
}

/**
 * How far the full-page screenshot being taken has got, or null when none is
 * running. Kept in storage, so a popup opened again mid-capture shows it too.
 */
export function useFullPageProgress(): FullPageProgress | null {
  const [progress, setProgress] = useState<FullPageProgress | null>(null)

  useEffect(() => {
    chrome.storage.local
      .get(FULL_PAGE_CAPTURE_STORAGE_KEY)
      .then((result) =>
        setProgress(readProgress(result[FULL_PAGE_CAPTURE_STORAGE_KEY]))
      )
      .catch((error: unknown) => {
        reportNonFatalError("Failed to read the full-page progress", error)
      })

    const handleChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      const change = changes[FULL_PAGE_CAPTURE_STORAGE_KEY]
      if (areaName === "local" && change) {
        setProgress(readProgress(change.newValue))
      }
    }
    chrome.storage.onChanged.addListener(handleChange)
    return () => chrome.storage.onChanged.removeListener(handleChange)
  }, [])

  return progress
}
