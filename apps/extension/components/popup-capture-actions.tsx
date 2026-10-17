import { Button } from "@crikket/ui/components/ui/button"
import { cn } from "@crikket/ui/lib/utils"
import {
  Camera,
  type LucideIcon,
  MicOff,
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
  // A new capture replaces the report that was not sent yet.
  hasUnsentReport: boolean
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
  // Tint of the icon chip, so each action is easy to spot.
  accent: string
}

const RECORD_OPTIONS: CaptureOption[] = [
  {
    type: "video",
    title: "This tab",
    description: "Video, console, network",
    icon: Video,
    accent: "bg-rose-50 text-rose-600",
  },
  {
    type: "display",
    title: "Full screen",
    description: "Follows you across tabs",
    icon: Monitor,
    accent: "bg-indigo-50 text-indigo-600",
  },
]

const CAPTURE_OPTIONS: CaptureOption[] = [
  {
    type: "screenshot",
    title: "Screenshot",
    description: "What you see now",
    icon: Camera,
    accent: "bg-blue-50 text-blue-600",
  },
  {
    type: "fullpage",
    title: "Long screenshot",
    description: "Scrolls down the page",
    icon: ScrollText,
    accent: "bg-emerald-50 text-emerald-600",
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
  hasUnsentReport,
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

  // Like the timer while recording, also in a popup opened mid-capture.
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

  // The confirmation sits under the tiles it belongs to, so it stays next to
  // the picked tile and inside the popup's 600px.
  const renderPending = (options: CaptureOption[]) =>
    pendingCaptureType &&
    options.some((option) => option.type === pendingCaptureType) ? (
      <PendingCapturePanel
        captureType={pendingCaptureType}
        hasUnsentReport={hasUnsentReport}
        isBusy={isBusy}
        onCancel={onClearPendingCapture}
        onContinue={() => onStartCapture(pendingCaptureType)}
      />
    ) : null

  return (
    <div className="space-y-2.5">
      <section className="space-y-1.5">
        <SectionLabel>Record</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {renderTiles(RECORD_OPTIONS)}
        </div>
      </section>
      {renderPending(RECORD_OPTIONS)}

      <section className="space-y-1.5">
        <SectionLabel>Capture</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {renderTiles(CAPTURE_OPTIONS)}
        </div>
      </section>
      {renderPending(CAPTURE_OPTIONS)}

      <section className="space-y-1.5">
        <SectionLabel>Instant replay</SectionLabel>
        {instantReplayPanel}
      </section>
    </div>
  )
}

function PendingCapturePanel({
  captureType,
  hasUnsentReport,
  isBusy,
  onContinue,
  onCancel,
}: {
  captureType: PopupCaptureType
  hasUnsentReport: boolean
  isBusy: boolean
  onContinue: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
      <p className="text-foreground/80 text-xs leading-relaxed">
        {PENDING_MESSAGES[captureType]}
      </p>
      {hasUnsentReport ? (
        <p className="font-medium text-amber-800 text-xs leading-relaxed">
          Your unsent report will be deleted when this one starts.
        </p>
      ) : null}
      <div className="flex gap-1.5">
        <Button
          className={cn("flex-1", BRAND_BUTTON_CLASS)}
          disabled={isBusy}
          onClick={onContinue}
          size="sm"
        >
          {isBusy ? "Starting..." : "Continue"}
        </Button>
        <Button
          className="text-muted-foreground"
          disabled={isBusy}
          onClick={onCancel}
          size="sm"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

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
      className="space-y-2.5 rounded-lg border bg-card p-3.5 shadow-xs"
    >
      <div className="flex items-center justify-between font-semibold text-[13px]">
        <span>Taking a long screenshot</span>
        <span className="font-mono text-xs tabular-nums">{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${Math.max(4, percent)}%` }}
        />
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {hasScreens
          ? `Screen ${progress.screensDone} of ${progress.screensTotal}. `
          : "Getting the page ready. "}
        The page scrolls by itself; stop when you have the part you need. You
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
        <Square className="h-3 w-3 fill-current" />
        {isStopping ? "Stopping..." : "Stop here"}
      </Button>
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-0.5 font-semibold text-[10.5px] text-muted-foreground uppercase tracking-[0.06em]">
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
        "flex min-h-[88px] min-w-0 flex-col rounded-lg border bg-card p-2.5 text-left shadow-xs transition-colors",
        "hover:border-foreground/20",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-60",
        isSelected && "border-primary bg-primary/5 ring-1 ring-primary"
      )}
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span className="flex w-full items-center justify-between">
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-[9px]",
            option.accent
          )}
        >
          <Icon className="h-[17px] w-[17px]" />
        </span>
        <ShortcutKbd className={SHORTCUT_CHIP_CLASS} shortcut={shortcut} />
      </span>
      <span className="mt-2 block font-semibold text-[13px]">
        {option.title}
      </span>
      <span className="block truncate text-[11px] text-muted-foreground">
        {option.description}
      </span>
    </button>
  )
}

function CountdownPanel({ seconds }: { seconds: number }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-card px-4 py-6 text-center shadow-xs">
      <p className="text-muted-foreground text-xs">Recording starts in</p>
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 font-mono font-semibold text-2xl text-white"
        key={seconds}
      >
        {seconds}
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
  "h-9 w-full border-white/12 bg-white/5 text-white shadow-none hover:bg-white/10 hover:text-white"

// Shortcut keys on the tiles and buttons: small, quiet chips.
const SHORTCUT_CHIP_CLASS =
  "h-[18px] min-w-0 rounded-[5px] border bg-background px-1 font-mono text-[10px] text-muted-foreground"
const SHORTCUT_ON_DARK_CLASS =
  "h-[18px] min-w-0 rounded-[5px] bg-white/15 px-1 font-mono text-[10px] text-white"

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
    <div className="space-y-2.5 rounded-lg bg-slate-900 p-3.5 text-white">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-medium text-[13px] text-white/85">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              isPaused
                ? "bg-amber-400 ring-3 ring-amber-400/25"
                : "bg-rose-500 ring-3 ring-rose-500/25"
            )}
          />
          {isPaused ? "Paused" : "Recording"}
        </span>
        <span
          className={cn(
            "font-mono font-semibold text-[22px] tabular-nums tracking-tight",
            isPaused && "text-white/55"
          )}
        >
          {formatDuration(durationMs)}
        </span>
      </div>
      <p className="text-white/70 text-xs leading-relaxed">
        {getRecordingHint(isPaused, hasFloatingBar)}
      </p>
      <Button
        className="h-9 w-full justify-between bg-rose-600 text-white hover:bg-rose-700"
        disabled={isBusy}
        onClick={() => onStop()}
      >
        <span className="flex items-center gap-2">
          <Square className="h-3 w-3 fill-current" />
          Stop and review
        </span>
        <ShortcutKbd
          className={SHORTCUT_ON_DARK_CLASS}
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
          className={SHORTCUT_ON_DARK_CLASS}
          shortcut={togglePauseShortcut}
        />
      </Button>
      {micState === "unavailable" ? (
        <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-white/65">
          <MicOff className="h-3.5 w-3.5" />
          No microphone. Tab sound only.
        </p>
      ) : (
        <MicToggleButton
          className={cn(DARK_OUTLINE_BUTTON_CLASS, "justify-start gap-2")}
          micState={micState}
          onToggle={onToggleMic}
        />
      )}
    </div>
  )
}
