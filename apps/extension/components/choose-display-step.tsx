import { Monitor } from "lucide-react"
import { StartPrompt } from "@/components/start-prompt"

interface ChooseDisplayStepProps {
  onChoose: () => Promise<void>
}

// Chrome only opens the screen picker from a click on this page.
export function ChooseDisplayStep({ onChoose }: ChooseDisplayStepProps) {
  return (
    <StartPrompt
      actionLabel="Share your screen"
      description="Chrome will ask which screen or window to share. Crikket takes you back to your tab, then follows you across tabs."
      icon={Monitor}
      onStart={onChoose}
      title="Pick what to record"
    />
  )
}
