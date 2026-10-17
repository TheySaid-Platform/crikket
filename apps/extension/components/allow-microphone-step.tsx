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
      description="Chrome will ask to use your microphone, so your voice is recorded with the tab's sound. You only do this once."
      icon={Mic}
      onStart={onStart}
      title="Allow the microphone once"
    />
  )
}
