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
    <div className="flex flex-col items-center justify-center gap-6 py-10">
      <div className="relative w-full max-w-sm space-y-3 overflow-hidden rounded-2xl bg-zinc-950 p-6 text-center text-white shadow-lg">
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full blur-3xl",
            isPaused ? "bg-amber-500/25" : "bg-rose-500/25"
          )}
        />
        <p className="relative flex items-center justify-center gap-2 font-medium text-sm text-white/70">
          <span className="relative flex h-2.5 w-2.5">
            {isPaused ? null : (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
            )}
            <span
              className={cn(
                "relative inline-flex h-2.5 w-2.5 rounded-full",
                isPaused ? "bg-amber-400" : "bg-rose-500"
              )}
            />
          </span>
          {isPaused ? "Recording paused" : "Recording"}
        </p>
        <p
          className={cn(
            "relative font-mono font-semibold text-5xl tabular-nums",
            isPaused && "text-white/60"
          )}
        >
          {formatDuration(duration)}
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-2">
        <Button
          className="w-full justify-between bg-rose-500 text-white hover:bg-rose-600"
          onClick={onStopRecording}
          size="lg"
        >
          <span className="flex items-center gap-2">
            <Square className="h-4 w-4 fill-current" />
            Stop and review
          </span>
          <ShortcutKbd
            className="bg-white/15 text-white"
            shortcut={stopRecordingShortcut}
          />
        </Button>
        <Button
          className="w-full justify-between"
          onClick={onTogglePause}
          size="lg"
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
            className="bg-muted text-foreground"
            shortcut={togglePauseShortcut}
          />
        </Button>
        <MicToggleButton
          className="w-full gap-2"
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
