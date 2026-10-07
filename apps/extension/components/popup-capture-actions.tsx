import { Button } from "@crikket/ui/components/ui/button"
import { cn } from "@crikket/ui/lib/utils"
import {
  Camera,
  type LucideIcon,
  Monitor,
  Pause,
  Play,
  ScrollText,
  Square,
  Video,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { MicToggleButton } from "@/components/mic-toggle-button"
import { ShortcutKbd } from "@/components/shortcut-kbd"
import type { PopupCaptureType } from "@/hooks/use-popup-capture"
import type { MicState } from "@/hooks/use-screen-capture"
import { BRAND_BUTTON_CLASS } from "@/lib/brand"
import type { FullPageProgress } from "@/lib/full-page-screenshot"
import { formatDuration } from "@/lib/utils"

interface PopupCaptureActionsProps {
  // The recording has the floating bar on the page (background recordings).
  hasFloatingBar: boolean
  isBusy: boolean
  isRecordingInProgress: boolean
  isRecordingPaused: boolean
  micState: MicState
  onToggleMic: () => void
  recordingCountdown: number | null
  recordingDurationMs: number
  pendingCaptureType: PopupCaptureType | null
  // Set while a full-page screenshot is being taken.
  fullPageProgress: FullPageProgress | null
  startRecordingShortcut: string | null
  startScreenshotShortcut: string | null
  stopRecordingShortcut: string | null
  togglePauseShortcut: string | null
  onRequestCapture: (captureType: PopupCaptureType) => void
  onStopFromPopup: () => Promise<void>
  onTogglePause: () => Promise<void>
  onStartCapture: (captureType: PopupCaptureType) => Promise<void>
  onClearPendingCapture: () => void
  // Ends a full-page screenshot early, keeping what was captured so far.
  onStopFullPage: () => void
  // Shown with the capture options, not while recording or capturing.
  instantReplayPanel: ReactNode
}

interface CaptureOption {
  type: PopupCaptureType
  title: string
  description: string
  icon: LucideIcon
  // Gradient of the icon chip, so each action is easy to spot.
  accent: string
}

const RECORD_OPTIONS: CaptureOption[] = [
  {
    type: "video",
    title: "This tab",
    description: "Video, console and network",
    icon: Video,
    accent: "from-rose-500 to-orange-400 shadow-rose-500/30",
  },
  {
    type: "display",
    title: "Full screen",
    description: "Follows you across tabs",
    icon: Monitor,
    accent: "from-violet-500 to-indigo-500 shadow-violet-500/30",
  },
]

const CAPTURE_OPTIONS: CaptureOption[] = [
  {
    type: "screenshot",
    title: "Screenshot",
    description: "What you see now",
    icon: Camera,
    accent: "from-sky-500 to-blue-500 shadow-sky-500/30",
  },
  {
    type: "fullpage",
    title: "Long screenshot",
    description: "From where you are, down the page",
    icon: ScrollText,
    accent: "from-emerald-500 to-teal-500 shadow-emerald-500/30",
  },
]

const PENDING_MESSAGES: Record<PopupCaptureType, string> = {
  video:
    "Crikket records this tab with its console and network. A floating bar on the page controls the recording.",
  display:
    "Chrome asks which screen to share next. Crikket keeps the console and network of every tab you visit.",
  screenshot: "Crikket captures what's visible in this tab right now.",
  fullpage:
    "Crikket starts at what you see now and scrolls down the page, up to 10 screens. Stay on this tab until it's done.",
}

export function PopupCaptureActions({
  hasFloatingBar,
  isBusy,
  isRecordingInProgress,
  isRecordingPaused,
  micState,
  onToggleMic,
  recordingCountdown,
  recordingDurationMs,
  pendingCaptureType,
  fullPageProgress,
  startRecordingShortcut,
  startScreenshotShortcut,
  stopRecordingShortcut,
  togglePauseShortcut,
  onRequestCapture,
  onStopFromPopup,
  onTogglePause,
  onStartCapture,
  onClearPendingCapture,
  onStopFullPage,
  instantReplayPanel,
}: PopupCaptureActionsProps) {
  if (recordingCountdown) {
    return <CountdownPanel seconds={recordingCountdown} />
  }

  // Only the progress while the page is being captured, like the timer
  // while recording; also in a popup opened again mid-capture.
  if (fullPageProgress || (pendingCaptureType === "fullpage" && isBusy)) {
    return (
      <FullPageProgressPanel
        onStop={onStopFullPage}
        progress={fullPageProgress}
      />
    )
  }

  if (isRecordingInProgress) {
    return (
      <RecordingPanel
        durationMs={recordingDurationMs}
        hasFloatingBar={hasFloatingBar}
        isBusy={isBusy}
        isPaused={isRecordingPaused}
        micState={micState}
        onStop={onStopFromPopup}
        onToggleMic={onToggleMic}
        onTogglePause={onTogglePause}
        stopShortcut={stopRecordingShortcut}
        togglePauseShortcut={togglePauseShortcut}
      />
    )
  }

  const shortcuts: Partial<Record<PopupCaptureType, string | null>> = {
    video: startRecordingShortcut,
    screenshot: startScreenshotShortcut,
  }
  const renderTiles = (options: CaptureOption[]) =>
    options.map((option) => (
      <CaptureTile
        disabled={isBusy}
        isSelected={pendingCaptureType === option.type}
        key={option.type}
        onSelect={() => onRequestCapture(option.type)}
        option={option}
        shortcut={shortcuts[option.type] ?? null}
      />
    ))

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionLabel>Record</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {renderTiles(RECORD_OPTIONS)}
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel>Capture</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {renderTiles(CAPTURE_OPTIONS)}
        </div>
      </section>

      <section className="space-y-2">
        <SectionLabel>Instant replay</SectionLabel>
        {instantReplayPanel}
      </section>

      {pendingCaptureType ? (
        <PendingCapturePanel
          captureType={pendingCaptureType}
          isBusy={isBusy}
          onCancel={onClearPendingCapture}
          onContinue={() => onStartCapture(pendingCaptureType)}
        />
      ) : null}
    </div>
  )
}

function PendingCapturePanel({
  captureType,
  isBusy,
  onContinue,
  onCancel,
}: {
  captureType: PopupCaptureType
  isBusy: boolean
  onContinue: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-blue-500/20 bg-blue-50/80 p-3.5">
      <p className="text-foreground/80 text-xs leading-relaxed">
        {PENDING_MESSAGES[captureType]}
      </p>
      <div className="flex gap-2">
        <Button
          className={cn("flex-1", BRAND_BUTTON_CLASS)}
          disabled={isBusy}
          onClick={onContinue}
          size="sm"
        >
          {isBusy ? "Starting..." : "Continue"}
        </Button>
        <Button disabled={isBusy} onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  )
}

// The page scrolls by itself while a full-page screenshot is taken; this says
// what is going on and how much of the page is done.
function FullPageProgressPanel({
  progress,
  onStop,
}: {
  progress: FullPageProgress | null
  onStop: () => void
}) {
  const [isStopping, setIsStopping] = useState(false)
  const hasScreens = progress !== null && progress.screensTotal > 0
  const percent = hasScreens
    ? Math.round((progress.screensDone / progress.screensTotal) * 100)
    : 0

  return (
    <div
      aria-live="polite"
      className="space-y-3 rounded-2xl border border-emerald-500/25 bg-emerald-50/80 p-3.5"
    >
      <div className="flex items-center justify-between font-medium text-sm">
        <span>Taking a long screenshot</span>
        <span className="text-emerald-700 tabular-nums">{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-emerald-100">
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
          style={{ width: `${Math.max(4, percent)}%` }}
        />
      </div>
      <p className="text-foreground/75 text-xs leading-relaxed">
        {hasScreens
          ? `Screen ${progress.screensDone} of ${progress.screensTotal}. `
          : "Getting the page ready. "}
        The page scrolls by itself. Stop when you have the part you need; you
        can cut it more in the review.
      </p>
      <Button
        className="w-full"
        disabled={isStopping}
        onClick={() => {
          setIsStopping(true)
          onStop()
        }}
        size="sm"
        variant="outline"
      >
        <Square className="h-3.5 w-3.5 fill-current" />
        {isStopping ? "Stopping..." : "Stop here"}
      </Button>
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
      {children}
    </p>
  )
}

function CaptureTile({
  option,
  shortcut,
  isSelected,
  disabled,
  onSelect,
}: {
  option: CaptureOption
  shortcut: string | null
  isSelected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const Icon = option.icon
  return (
    <button
      aria-pressed={isSelected}
      className={cn(
        "group relative flex flex-col items-start gap-3 rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-xs transition-all duration-200",
        "hover:-translate-y-0.5 hover:border-border hover:shadow-lg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-60",
        isSelected && "border-blue-500/50 ring-2 ring-blue-500/25"
      )}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br text-white shadow-md transition-transform duration-200 group-hover:scale-105",
          option.accent
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="space-y-0.5">
        <span className="block font-semibold text-sm">{option.title}</span>
        <span className="block text-muted-foreground text-xs leading-snug">
          {option.description}
        </span>
      </span>
      {shortcut ? (
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium font-mono text-[10px] text-muted-foreground">
          {shortcut}
        </span>
      ) : null}
    </button>
  )
}

function CountdownPanel({ seconds }: { seconds: number }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border/60 bg-card px-4 py-7 text-center shadow-xs">
      <p className="font-medium text-muted-foreground text-sm">
        Recording starts in
      </p>
      <span className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/25" />
        <span
          className="relative flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-br from-rose-500 to-orange-400 font-bold text-4xl text-white shadow-lg shadow-rose-500/40"
          key={seconds}
        >
          {seconds}
        </span>
      </span>
    </div>
  )
}

function getRecordingHint(isPaused: boolean, hasFloatingBar: boolean) {
  if (isPaused) {
    return "Nothing is recorded while paused: no video, console logs or network requests."
  }
  return hasFloatingBar
    ? "You can also pause, mute, draw or blur from the floating bar on the page."
    : "Pause to leave something out of the report."
}

const DARK_OUTLINE_BUTTON_CLASS =
  "relative w-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"

function RecordingPanel({
  durationMs,
  hasFloatingBar,
  isBusy,
  isPaused,
  micState,
  stopShortcut,
  togglePauseShortcut,
  onStop,
  onToggleMic,
  onTogglePause,
}: {
  durationMs: number
  hasFloatingBar: boolean
  isBusy: boolean
  isPaused: boolean
  micState: MicState
  stopShortcut: string | null
  togglePauseShortcut: string | null
  onStop: () => Promise<void>
  onToggleMic: () => void
  onTogglePause: () => Promise<void>
}) {
  return (
    <div className="relative space-y-3 overflow-hidden rounded-2xl bg-zinc-950 p-4 text-white shadow-lg">
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -top-16 -right-12 h-40 w-40 rounded-full blur-3xl",
          isPaused ? "bg-amber-500/25" : "bg-rose-500/25"
        )}
      />
      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium text-sm text-white/80">
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
          {isPaused ? "Paused" : "Recording"}
        </span>
        <span
          className={cn(
            "font-mono font-semibold text-2xl tabular-nums",
            isPaused && "text-white/60"
          )}
        >
          {formatDuration(durationMs)}
        </span>
      </div>
      <p className="relative text-white/60 text-xs">
        {getRecordingHint(isPaused, hasFloatingBar)}
      </p>
      <Button
        className="relative w-full justify-between bg-rose-500 text-white hover:bg-rose-600"
        disabled={isBusy}
        onClick={() => onStop()}
        size="lg"
      >
        <span className="flex items-center gap-2">
          <Square className="h-4 w-4 fill-current" />
          Stop and review
        </span>
        <ShortcutKbd
          className="bg-white/15 text-white"
          shortcut={stopShortcut}
        />
      </Button>
      <Button
        className={cn(DARK_OUTLINE_BUTTON_CLASS, "justify-between")}
        disabled={isBusy}
        onClick={() => onTogglePause()}
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
          className="bg-white/15 text-white"
          shortcut={togglePauseShortcut}
        />
      </Button>
      <MicToggleButton
        className={cn(DARK_OUTLINE_BUTTON_CLASS, "justify-start gap-2")}
        micState={micState}
        onToggle={onToggleMic}
      />
    </div>
  )
}
