import { Button } from "@crikket/ui/components/ui/button"
import { cn } from "@crikket/ui/lib/utils"
import { Pause, Play, Square } from "lucide-react"
import { MicToggleButton } from "@/components/mic-toggle-button"
import { ShortcutKbd } from "@/components/shortcut-kbd"
import type { MicState } from "@/hooks/use-screen-capture"
import { formatDuration } from "../lib/utils"

interface RecordingStepProps {
  duration: number
  isPaused: boolean
  micState: MicState
  onStopRecording: () => void
  onTogglePause: () => void
  onToggleMic: () => void
  stopRecordingShortcut: string | null
  togglePauseShortcut: string | null
}

export function RecordingStep({
  duration,
  isPaused,
  micState,
  onStopRecording,
  onTogglePause,
  onToggleMic,
  stopRecordingShortcut,
  togglePauseShortcut,
}: RecordingStepProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 px-6 py-12">
      <div className="w-full max-w-sm space-y-2 rounded-lg bg-slate-900 p-6 text-center text-white">
        <p className="flex items-center justify-center gap-2 font-medium text-[13px] text-white/80">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isPaused
                ? "bg-amber-400 ring-3 ring-amber-400/25"
                : "bg-rose-500 ring-3 ring-rose-500/25"
            )}
          />
          {isPaused ? "Recording paused" : "Recording"}
        </p>
        <p
          className={cn(
            "font-mono font-semibold text-5xl tabular-nums tracking-tight",
            isPaused && "text-white/55"
          )}
        >
          {formatDuration(duration)}
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-2">
        <Button
          className="h-10 w-full justify-between bg-rose-600 text-white hover:bg-rose-700"
          onClick={onStopRecording}
        >
          <span className="flex items-center gap-2">
            <Square className="h-3 w-3 fill-current" />
            Stop and review
          </span>
          <ShortcutKbd
            className="h-[18px] min-w-0 rounded-[5px] bg-white/15 px-1 font-mono text-[10px] text-white"
            shortcut={stopRecordingShortcut}
          />
        </Button>
        <Button
          className="h-10 w-full justify-between"
          onClick={onTogglePause}
          variant="outline"
        >
          <span className="flex items-center gap-2">
            {isPaused ? (
              <Play className="h-4 w-4" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
            {isPaused ? "Resume" : "Pause"}
          </span>
          <ShortcutKbd
            className="h-[18px] min-w-0 rounded-[5px] border bg-background px-1 font-mono text-[10px] text-muted-foreground"
            shortcut={togglePauseShortcut}
          />
        </Button>
        <MicToggleButton
          className="h-10 w-full gap-2"
          micState={micState}
          onToggle={onToggleMic}
        />
      </div>

      <p className="max-w-md text-center text-muted-foreground text-sm">
        {isPaused
          ? "Nothing is recorded while paused: no video, console logs or network requests. Resume when you're ready."
          : "Switch back to the page you're recording. Pause to leave something out. When you're done, press Stop to trim, add details and send your report."}
      </p>
    </div>
  )
}
