import { Button } from "@crikket/ui/components/ui/button"
import { Pause, Play } from "lucide-react"
import { ShortcutKbd } from "@/components/shortcut-kbd"
import { formatDuration } from "../lib/utils"

interface RecordingStepProps {
  duration: number
  isPaused: boolean
  onStopRecording: () => void
  onTogglePause: () => void
  stopRecordingShortcut: string | null
  togglePauseShortcut: string | null
}

export function RecordingStep({
  duration,
  isPaused,
  onStopRecording,
  onTogglePause,
  stopRecordingShortcut,
  togglePauseShortcut,
}: RecordingStepProps) {
  return (
    <div className="flex flex-col items-center justify-center space-y-6 py-12">
      <div
        className={
          isPaused
            ? "w-full max-w-sm rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-center text-amber-700"
            : "w-full max-w-sm rounded-md border border-destructive/20 bg-destructive/5 p-4 text-center text-destructive"
        }
      >
        <p className="font-medium text-sm">
          {isPaused ? "Recording paused" : "Recording now"}
        </p>
        <p className="font-mono font-semibold text-5xl">
          {formatDuration(duration)}
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-3">
        <Button
          className="flex min-w-[200px] items-center gap-3 font-semibold text-lg"
          onClick={onTogglePause}
          size="lg"
          variant="outline"
        >
          {isPaused ? <Play /> : <Pause />}
          <span>{isPaused ? "Resume" : "Pause"}</span>
          <ShortcutKbd
            className="bg-muted text-foreground"
            shortcut={togglePauseShortcut}
          />
        </Button>

        <Button
          className="flex min-w-[200px] items-center gap-3 font-semibold text-lg"
          onClick={onStopRecording}
          size="lg"
          variant="destructive"
        >
          <span>⏹ Stop Recording</span>
          <ShortcutKbd
            className="bg-destructive-foreground/15 text-destructive-foreground"
            shortcut={stopRecordingShortcut}
          />
        </Button>
      </div>

      <p className="max-w-md text-center text-muted-foreground text-sm">
        {isPaused
          ? "Nothing is recorded while paused: no video, console logs or network requests. Resume when you're ready."
          : "Pause to leave something out of the recording. Click \"Stop Recording\" when you're done capturing the issue. You'll be able to add details and submit your bug report next."}
      </p>
    </div>
  )
}
