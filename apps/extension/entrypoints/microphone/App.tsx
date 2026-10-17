import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { Mic } from "lucide-react"
import { useEffect, useRef } from "react"
import { StartPrompt } from "@/components/start-prompt"
import {
  isMicrophonePermissionUndecided,
  markMicrophoneAsked,
} from "@/lib/microphone-permission"

// Back to the tab the user came from, so they can record there.
async function returnToOpenerTab(): Promise<void> {
  const tab = await chrome.tabs.getCurrent()
  if (typeof tab?.openerTabId === "number") {
    await chrome.tabs.update(tab.openerTabId, { active: true })
  }
  window.close()
}

async function askForMicrophone(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) {
      track.stop()
    }
  } catch {
    // Blocked or dismissed; a dismissed prompt can be asked again below.
  }
  await markMicrophoneAsked()
  if (await isMicrophonePermissionUndecided()) {
    return
  }
  await returnToOpenerTab()
}

function App() {
  const hasAsked = useRef(false)

  useEffect(() => {
    if (hasAsked.current) return
    hasAsked.current = true
    askForMicrophone().catch((error: unknown) => {
      reportNonFatalError("Failed to ask for the microphone", error)
    })
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-linear-to-b from-slate-100 to-background p-6">
      <StartPrompt
        actionLabel="Allow microphone"
        busyLabel="Waiting for Chrome..."
        description={`When Chrome asks, pick "Allow while visiting the site" so your voice is recorded with every bug report. "Allow this time" stops working as soon as this page closes.`}
        icon={Mic}
        onStart={askForMicrophone}
        title="Allow your microphone"
      />
    </main>
  )
}

export default App
