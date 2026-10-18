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
    <div className="space-y-2.5 rounded-2xl border border-border/60 bg-card p-3 shadow-xs">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br text-white shadow-md",
            replay.isEnabled
              ? "from-amber-500 to-pink-500 shadow-amber-500/30"
              : "from-zinc-400 to-zinc-500 shadow-zinc-500/20"
          )}
        >
          <History className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm">
            {replay.isEnabled ? "Instant replay is on" : "Instant replay"}
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {replay.isEnabled
              ? `Keeps the last ${WINDOW_MINUTES} min; nothing uploads until you share`
              : `Report a bug after it happens: keeps the last ${WINDOW_MINUTES} min`}
          </p>
        </div>
        {replay.isEnabled ? (
          <Button
            disabled={replay.isSaving}
            onClick={() => replay.setEnabled(false)}
            size="sm"
            variant="ghost"
          >
            Turn off
          </Button>
        ) : (
          <Button
            disabled={disabled}
            onClick={() => replay.setEnabled(true)}
            size="sm"
            variant="outline"
          >
            Turn on
          </Button>
        )}
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
        <Button
          className={cn("w-full justify-between", BRAND_BUTTON_CLASS)}
          disabled={disabled || replay.isSaving}
          onClick={replay.save}
          size="sm"
        >
          {replay.isSaving
            ? "Opening the replay..."
            : `Share the last ${WINDOW_MINUTES} minutes`}
          <ShortcutKbd className="bg-white/15 text-white" shortcut={shortcut} />
        </Button>
      ) : null}
    </div>
  )
}

function VideoRow({ replay }: { replay: InstantReplayControls }) {
  const isRecording =
    replay.videoStatus === "this-tab" || replay.videoStatus === "screen"
  const isBusy = replay.isStartingVideo || replay.isSaving

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-muted/60 px-2.5 py-2">
      <p className="flex flex-1 items-center gap-2 text-xs">
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
