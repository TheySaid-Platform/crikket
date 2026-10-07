import { Mic } from "lucide-react"
import { StartPrompt } from "@/components/start-prompt"

interface AllowMicrophoneStepProps {
  onStart: () => Promise<void>
}

// Shown only before the first recording. Starting from this click lets Chrome
// mix the user's voice with the tab's sound; later recordings start on their
// own once the microphone has been allowed.
export function AllowMicrophoneStep({ onStart }: AllowMicrophoneStepProps) {
  return (
    <StartPrompt
      actionLabel="Start recording"
      description="Chrome will ask to use your microphone so your voice is recorded along with the tab's sound. You only need to do this once."
      icon={Mic}
      onStart={onStart}
      title="One quick step first"
    />
  )
}
