import { Button } from "@crikket/ui/components/ui/button"
import type { LucideIcon } from "lucide-react"
import { useState } from "react"
import { BRAND_BUTTON_CLASS } from "@/lib/brand"

interface StartPromptProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel: string
  busyLabel?: string
  onStart: () => Promise<void>
}

// A single call to action, used when Chrome needs a page of ours before it can
// record (screen picker, microphone prompt).
export function StartPrompt({
  icon: Icon,
  title,
  description,
  actionLabel,
  busyLabel = "Starting...",
  onStart,
}: StartPromptProps) {
  const [isStarting, setIsStarting] = useState(false)

  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <div className="max-w-md space-y-1.5">
        <h2 className="font-semibold text-lg tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {description}
        </p>
      </div>
      <Button
        className={`mt-1 h-10 min-w-[200px] ${BRAND_BUTTON_CLASS}`}
        disabled={isStarting}
        onClick={async () => {
          setIsStarting(true)
          try {
            await onStart()
          } finally {
            setIsStarting(false)
          }
        }}
      >
        {isStarting ? busyLabel : actionLabel}
      </Button>
    </div>
  )
}
