import { Button } from "@crikket/ui/components/ui/button"
import { MicOff } from "lucide-react"
import type { MicrophoneProblem } from "@/lib/microphone-permission"

const COPY: Record<MicrophoneProblem, { message: string; action: string }> = {
  off: { message: "Your voice won't be recorded.", action: "Allow mic" },
  blocked: {
    message: "Your mic is blocked. Set Microphone to Allow in settings.",
    action: "Open settings",
  },
}

export function MicrophoneProblemCard({
  problem,
  onFix,
}: {
  problem: MicrophoneProblem
  onFix: () => void
}) {
  const { message, action } = COPY[problem]
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-50 p-3">
      <p className="flex items-center gap-2 text-amber-900 text-sm">
        <MicOff className="h-4 w-4 shrink-0" />
        {message}
      </p>
      <Button className="shrink-0" onClick={onFix} size="sm" variant="outline">
        {action}
      </Button>
    </div>
  )
}
