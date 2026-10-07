import { ReplayPlayer } from "@crikket/ui/components/replay-player"
import { cn } from "@crikket/ui/lib/utils"
import { useMemo } from "react"
import {
  INSTANT_REPLAY_CHECKOUT_MS,
  keepLastReplay,
  type ReplayEvent,
} from "@/lib/instant-replay/protocol"
import { formatDuration } from "@/lib/utils"

// What the user can keep, besides all of it.
const KEEP_CHOICES_MS = [30_000, 60_000, 3 * 60_000]

interface ReplayPreviewProps {
  // The whole replay, and the part that will be sent.
  events: ReplayEvent[]
  keptEvents: ReplayEvent[]
  disabled: boolean
  // null keeps all of it.
  onKeepChange: (keepMs: number | null) => void
}

interface KeepChoice {
  keepMs: number | null
  durationMs: number
}

const getDurationMs = (events: ReplayEvent[]) =>
  (events.at(-1)?.timestamp ?? 0) - (events[0]?.timestamp ?? 0)

// A replay can only start at a full snapshot, so each choice keeps a little
// more than it says; the buttons show what it really keeps.
function getKeepChoices(events: ReplayEvent[]): KeepChoice[] {
  const totalMs = getDurationMs(events)
  const choices: KeepChoice[] = []
  for (const keepMs of KEEP_CHOICES_MS) {
    const durationMs = getDurationMs(keepLastReplay(events, keepMs))
    if (
      durationMs < totalMs &&
      !choices.some((choice) => choice.durationMs === durationMs)
    ) {
      choices.push({ keepMs, durationMs })
    }
  }
  choices.push({ keepMs: null, durationMs: totalMs })
  return choices
}

/** The saved instant replay, and how much of it to send. */
export function ReplayPreview({
  events,
  keptEvents,
  disabled,
  onKeepChange,
}: ReplayPreviewProps) {
  const choices = useMemo(() => getKeepChoices(events), [events])
  const keptMs = getDurationMs(keptEvents)

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border bg-black shadow-sm">
        <ReplayPlayer className="w-full" events={keptEvents} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">Send the last</span>
        {choices.map((choice) => (
          <button
            aria-pressed={choice.durationMs === keptMs}
            className={cn(
              "rounded-full border px-3 py-1 font-medium text-xs tabular-nums transition-colors",
              "hover:bg-muted disabled:pointer-events-none disabled:opacity-60",
              choice.durationMs === keptMs &&
                "border-blue-500/50 bg-blue-50 text-blue-700 hover:bg-blue-50"
            )}
            disabled={disabled}
            key={choice.durationMs}
            onClick={() => onKeepChange(choice.keepMs)}
            type="button"
          >
            {formatDuration(choice.durationMs)}
            {choice.keepMs === null ? " (all)" : ""}
          </button>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        A replay rebuilds the page from what changed, not a video. It can start
        every {INSTANT_REPLAY_CHECKOUT_MS / 1000} seconds, and only the part you
        send is uploaded, with its console and network logs.
      </p>
    </div>
  )
}
