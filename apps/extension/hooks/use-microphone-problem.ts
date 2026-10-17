import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { useCallback, useEffect, useState } from "react"
import {
  getMicrophoneProblem,
  type MicrophoneProblem,
  openMicrophonePage,
  openMicrophoneSettings,
} from "@/lib/microphone-permission"

// For the popup: why recordings will have no voice, and the way to fix it.
export function useMicrophoneProblem() {
  const [problem, setProblem] = useState<MicrophoneProblem | null>(null)

  useEffect(() => {
    getMicrophoneProblem()
      .then(setProblem)
      .catch((error: unknown) => {
        reportNonFatalError("Failed to read the microphone permission", error)
      })
  }, [])

  const fixMicrophone = useCallback(async () => {
    try {
      if (problem === "blocked") {
        await openMicrophoneSettings()
      } else {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        })
        await openMicrophonePage(tab?.id)
      }
      window.close()
    } catch (error) {
      reportNonFatalError("Failed to open the microphone fix", error)
    }
  }, [problem])

  return { microphoneProblem: problem, fixMicrophone }
}
