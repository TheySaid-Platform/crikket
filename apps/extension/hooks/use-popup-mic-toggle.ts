import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useCallback, useEffect, useState } from "react"
import type { MicState } from "@/hooks/use-screen-capture"
import {
  RECORDING_MIC_STATE_STORAGE_KEY,
  TOGGLE_MIC_MESSAGE_TYPE,
} from "@/lib/capture-context"

const readMicState = (value: unknown): MicState =>
  value === "on" || value === "off" ? value : "unavailable"

export function usePopupMicToggle() {
  const [micState, setMicState] = useState<MicState>("unavailable")

  useEffect(() => {
    chrome.storage.local
      .get([RECORDING_MIC_STATE_STORAGE_KEY])
      .then((result) => {
        setMicState(readMicState(result[RECORDING_MIC_STATE_STORAGE_KEY]))
      })
      .catch((error: unknown) => {
        reportNonFatalError("Failed to read recorder mic state", error)
      })

    const handleStorageChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== "local") return
      const change = changes[RECORDING_MIC_STATE_STORAGE_KEY]
      if (!change) return
      setMicState(readMicState(change.newValue))
    }

    chrome.storage.onChanged.addListener(handleStorageChange)

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  const toggleMic = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({ type: TOGGLE_MIC_MESSAGE_TYPE })
    } catch (error) {
      reportNonFatalError("Failed to toggle mic from popup", error)
    }
  }, [])

  return { micState, toggleMic }
}
