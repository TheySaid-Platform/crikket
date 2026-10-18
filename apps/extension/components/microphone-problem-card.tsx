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
    <div className="flex min-h-[38px] items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 py-1.5 pr-1.5 pl-2.5 text-amber-800">
      <MicOff className="h-3.5 w-3.5 shrink-0" />
      <p className="flex-1 font-medium text-xs leading-snug">{message}</p>
      <button
        className="h-[26px] shrink-0 rounded-md border border-amber-200 bg-white px-2.5 font-semibold text-[11.5px] transition-colors hover:bg-amber-100"
        onClick={onFix}
        type="button"
      >
        {action}
      </button>
    </div>
  )
}
