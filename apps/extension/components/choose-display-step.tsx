import { Button } from "@crikket/ui/components/ui/button"
import { Monitor } from "lucide-react"
import { useState } from "react"

interface ChooseDisplayStepProps {
  onChoose: () => Promise<void>
}

// Chrome only opens the screen picker from a click on this page.
export function ChooseDisplayStep({ onChoose }: ChooseDisplayStepProps) {
  const [isChoosing, setIsChoosing] = useState(false)

  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-12">
      <Button
        className="flex min-w-[240px] items-center gap-3 font-semibold text-lg"
        disabled={isChoosing}
        onClick={async () => {
          setIsChoosing(true)
          try {
            await onChoose()
          } finally {
            setIsChoosing(false)
          }
        }}
        size="lg"
      >
        <Monitor className="h-5 w-5" />
        <span>Share your screen</span>
      </Button>

      <p className="max-w-md text-center text-muted-foreground text-sm">
        Chrome will ask which screen to share. We'll take you back to your tab
        when recording starts, then move through as many tabs as you need.
      </p>
    </div>
  )
}
