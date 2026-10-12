import { Button } from "@crikket/ui/components/ui/button"
import { Mic, MicOff } from "lucide-react"
import type { MicState } from "@/hooks/use-screen-capture"

interface MicToggleButtonProps {
  micState: MicState
  onToggle: () => void
  className?: string
}

export function MicToggleButton({
  micState,
  onToggle,
  className,
}: MicToggleButtonProps) {
  if (micState === "unavailable") {
    return (
      <p className="text-center text-muted-foreground text-xs">
        Microphone not available. Only tab audio is being recorded.
      </p>
    )
  }

  const isOn = micState === "on"

  return (
    <Button
      aria-pressed={isOn}
      className={className}
      onClick={onToggle}
      type="button"
      variant="outline"
    >
      {isOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      <span>
        {isOn ? "Mic on: click to mute" : "Mic muted: click to unmute"}
      </span>
    </Button>
  )
}
