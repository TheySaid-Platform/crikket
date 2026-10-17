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

const VIDEO_CHOICES: {
  status: ReplayVideoStatus
  label: string
  icon?: typeof Video
}[] = [
  { status: "off", label: "No video" },
  { status: "this-tab", label: "This tab", icon: Video },
  { status: "screen", label: "Full screen", icon: Monitor },
]

/** Turns instant replay on and off, and saves the last minutes of the tab. */
export function InstantReplayPanel({
  replay,
  shortcut,
  disabled,
}: InstantReplayPanelProps) {
  return (
    <div className="space-y-2 rounded-lg border bg-card p-2.5 shadow-xs">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]",
            replay.isEnabled
              ? "bg-amber-50 text-amber-600"
              : "bg-muted text-muted-foreground"
          )}
        >
          <History className="h-[17px] w-[17px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[13px]">
            {replay.isEnabled ? `On · last ${WINDOW_MINUTES} minutes` : "Off"}
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {replay.isEnabled
              ? "With console and network. Nothing is uploaded until you send a report."
              : `Keeps the last ${WINDOW_MINUTES} minutes, so you can report a bug after it happens.`}
          </p>
        </div>
        {replay.isEnabled ? (
          <Button
            className="text-muted-foreground"
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

      {replay.isEnabled ? <VideoChoice replay={replay} /> : null}

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
          className={cn("h-8 w-full justify-between", BRAND_BUTTON_CLASS)}
          disabled={disabled || replay.isSaving}
          onClick={replay.save}
        >
          {replay.isSaving
            ? "Opening the replay..."
            : `Share the last ${WINDOW_MINUTES} minutes`}
          <ShortcutKbd
            className="h-[18px] min-w-0 rounded-[5px] bg-white/15 px-1 font-mono text-[10px] text-white"
            shortcut={shortcut}
          />
        </Button>
      ) : null}
    </div>
  )
}

// Whether the replay also keeps a video, and of what.
function VideoChoice({ replay }: { replay: InstantReplayControls }) {
  const isBusy = replay.isStartingVideo || replay.isSaving
  const isRecording =
    replay.videoStatus === "this-tab" || replay.videoStatus === "screen"

  const choose = (status: ReplayVideoStatus) => {
    if (status === "off") {
      if (isRecording) replay.stopVideo()
      return
    }
    replay.startVideo(status === "screen" ? "display" : "tab")
  }

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 rounded-md bg-muted p-0.5">
        {VIDEO_CHOICES.map(({ status, label, icon: Icon }) => {
          const isOn = replay.videoStatus === status
          return (
            <button
              aria-pressed={isOn}
              className={cn(
                "flex h-[26px] items-center justify-center gap-1.5 rounded-[5px] text-[11.5px] text-muted-foreground transition-colors",
                "hover:text-foreground disabled:pointer-events-none disabled:opacity-60",
                isOn &&
                  "bg-background font-semibold text-foreground shadow-xs ring-1 ring-border"
              )}
              disabled={isBusy || isOn}
              key={status}
              onClick={() => choose(status)}
              type="button"
            >
              {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
              {label}
              {isOn && status !== "off" ? (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
              ) : null}
            </button>
          )
        })}
      </div>
      {replay.isStartingVideo || replay.videoStatus === "other-tab" ? (
        <p className="text-[11px] text-muted-foreground">
          {replay.isStartingVideo
            ? "Starting the video..."
            : "The video is of another tab; here you get the page replay."}
        </p>
      ) : null}
    </div>
  )
}
