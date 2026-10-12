import { Button } from "@crikket/ui/components/ui/button"
import type { LucideIcon } from "lucide-react"
import { useState } from "react"
import { BRAND_BUTTON_CLASS } from "@/lib/brand"

interface StartPromptProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel: string
  onStart: () => Promise<void>
}

// A single call to action for the recorder tab, used when Chrome needs a click
// before it can record (screen picker, first microphone prompt).
export function StartPrompt({
  icon: Icon,
  title,
  description,
  actionLabel,
  onStart,
}: StartPromptProps) {
  const [isStarting, setIsStarting] = useState(false)

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-10 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-blue-600 to-violet-600 text-white shadow-blue-600/25 shadow-lg ring-8 ring-blue-500/10">
        <Icon className="h-7 w-7" />
      </span>
      <div className="max-w-md space-y-1.5">
        <h2 className="font-semibold text-xl tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <Button
        className={`min-w-[220px] ${BRAND_BUTTON_CLASS}`}
        disabled={isStarting}
        onClick={async () => {
          setIsStarting(true)
          try {
            await onStart()
          } finally {
            setIsStarting(false)
          }
        }}
        size="lg"
      >
        {isStarting ? "Starting..." : actionLabel}
      </Button>
    </div>
  )
}
