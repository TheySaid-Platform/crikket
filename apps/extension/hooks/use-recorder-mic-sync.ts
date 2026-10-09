import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useEffect } from "react"
import type { MicState } from "@/hooks/use-screen-capture"
import {
  RECORDING_MIC_STATE_STORAGE_KEY,
  TOGGLE_MIC_MESSAGE_TYPE,
} from "@/lib/capture-context"

interface UseRecorderMicSyncProps {
  isRecording: boolean
  micState: MicState
  onToggleMic: () => void
}

/** Lets the popup show and toggle the recorder tab's microphone. */
export function useRecorderMicSync({
  isRecording,
  micState,
  onToggleMic,
}: UseRecorderMicSyncProps) {
  useEffect(() => {
    const update = isRecording
      ? chrome.storage.local.set({
          [RECORDING_MIC_STATE_STORAGE_KEY]: micState,
        })
      : chrome.storage.local.remove([RECORDING_MIC_STATE_STORAGE_KEY])

    update.catch((error: unknown) => {
      reportNonFatalError("Failed to sync recorder mic state", error)
    })
  }, [isRecording, micState])

  useEffect(() => {
    const handleMessage = (message: { type?: string }) => {
      if (message.type !== TOGGLE_MIC_MESSAGE_TYPE) return
      if (!isRecording) return
      onToggleMic()
    }

    chrome.runtime.onMessage.addListener(handleMessage)

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [isRecording, onToggleMic])

  useEffect(() => {
    return () => {
      chrome.storage.local.remove([RECORDING_MIC_STATE_STORAGE_KEY])
    }
  }, [])
}
