import { Button } from "@crikket/ui/components/ui/button"
import { cn } from "@crikket/ui/lib/utils"
import { AlertCircle, History, Monitor, Video } from "lucide-react"
import { ShortcutKbd } from "@/components/shortcut-kbd"
import type {
  InstantReplayControls,
  ReplayVideoStatus,
} from "@/hooks/use-instant-replay"
import { BRAND_BUTTON_CLASS } from "@/lib/brand"
import { INSTANT_REPLAY_WINDOW_MS } from "@/lib/instant-replay/protocol"

const WINDOW_MINUTES = INSTANT_REPLAY_WINDOW_MS / 60_000

interface InstantReplayPanelProps {
  replay: InstantReplayControls
  shortcut: string | null
  disabled: boolean
}

const VIDEO_STATUS_TEXT: Record<ReplayVideoStatus, string> = {
  "this-tab": "Video of this tab is recording in the background.",
  screen: "Video of your screen is recording in the background.",
  "other-tab": "The video is of another tab; here you get the page replay.",
  off: "No video, only the page replay. Add a video:",
}

/** Turns instant replay on and off, and saves the last minutes of the tab. */
export function InstantReplayPanel({
  replay,
  shortcut,
  disabled,
}: InstantReplayPanelProps) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-card p-3.5 shadow-xs">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br text-white shadow-md",
            replay.isEnabled
              ? "from-amber-500 to-pink-500 shadow-amber-500/30"
              : "from-zinc-400 to-zinc-500 shadow-zinc-500/20"
          )}
        >
          <History className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-semibold text-sm">
            {replay.isEnabled ? "Instant replay is on" : "Instant replay"}
          </p>
          <p className="text-muted-foreground text-xs leading-snug">
            {replay.isEnabled
              ? `Crikket keeps the last ${WINDOW_MINUTES} minutes with console and network. Nothing is uploaded until you send a report.`
              : `Found a bug you didn't record? Crikket keeps the last ${WINDOW_MINUTES} minutes, so you can report it after it happens.`}
          </p>
        </div>
      </div>

      {replay.isEnabled ? <VideoRow replay={replay} /> : null}

      {replay.error ? (
        <p
          className="flex items-start gap-2 text-destructive text-xs"
          role="alert"
        >
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          {replay.error}
        </p>
      ) : null}

      {replay.isEnabled ? (
        <div className="flex gap-2">
          <Button
            className={cn("flex-1 justify-between", BRAND_BUTTON_CLASS)}
            disabled={disabled || replay.isSaving}
            onClick={replay.save}
            size="sm"
          >
            {replay.isSaving
              ? "Opening the replay..."
              : `Share the last ${WINDOW_MINUTES} minutes`}
            <ShortcutKbd
              className="bg-white/15 text-white"
              shortcut={shortcut}
            />
          </Button>
          <Button
            disabled={replay.isSaving}
            onClick={() => replay.setEnabled(false)}
            size="sm"
            variant="ghost"
          >
            Turn off
          </Button>
        </div>
      ) : (
        <Button
          className="w-full"
          disabled={disabled}
          onClick={() => replay.setEnabled(true)}
          size="sm"
          variant="outline"
        >
          Turn on instant replay
        </Button>
      )}
    </div>
  )
}

function VideoRow({ replay }: { replay: InstantReplayControls }) {
  const isRecording =
    replay.videoStatus === "this-tab" || replay.videoStatus === "screen"
  const isBusy = replay.isStartingVideo || replay.isSaving

  return (
    <div className="space-y-2 rounded-xl bg-muted/60 p-2.5">
      <p className="flex items-center gap-2 text-xs">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            isRecording ? "animate-pulse bg-rose-500" : "bg-zinc-400"
          )}
        />
        {replay.isStartingVideo
          ? "Starting the video..."
          : VIDEO_STATUS_TEXT[replay.videoStatus]}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {replay.videoStatus === "this-tab" ? null : (
          <Button
            disabled={isBusy}
            onClick={() => replay.startVideo("tab")}
            size="xs"
            variant="outline"
          >
            <Video className="h-3.5 w-3.5" />
            {replay.videoStatus === "off" ? "This tab" : "Record this tab"}
          </Button>
        )}
        {replay.videoStatus === "screen" ? null : (
          <Button
            disabled={isBusy}
            onClick={() => replay.startVideo("display")}
            size="xs"
            variant="outline"
          >
            <Monitor className="h-3.5 w-3.5" />
            Whole screen
          </Button>
        )}
        {isRecording ? (
          <Button
            disabled={isBusy}
            onClick={replay.stopVideo}
            size="xs"
            variant="ghost"
          >
            Stop video
          </Button>
        ) : null}
      </div>
    </div>
  )
}
