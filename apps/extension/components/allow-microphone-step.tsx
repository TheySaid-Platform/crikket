import { Mic } from "lucide-react"
import { StartPrompt } from "@/components/start-prompt"

interface AllowMicrophoneStepProps {
  onStart: () => Promise<void>
}

// Only before the first recording: starting from a click lets Chrome mix
// the microphone with the tab's sound.
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
