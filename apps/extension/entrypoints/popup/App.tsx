import { AlertCircle } from "lucide-react"
import { PopupCaptureActions } from "@/components/popup-capture-actions"
import { PopupFooter, PopupHeader } from "@/components/popup-header"
import { UnsentReportCard } from "@/components/unsent-report-card"
import { useBackgroundRecordingStatus } from "@/hooks/use-background-recording-status"
import { useCommandShortcuts } from "@/hooks/use-command-shortcuts"
import { useFullPageProgress } from "@/hooks/use-full-page-progress"
import { useHotkeyTrigger } from "@/hooks/use-hotkey-trigger"
import { usePopupCapture } from "@/hooks/use-popup-capture"
import { usePopupMicToggle } from "@/hooks/use-popup-mic-toggle"
import { usePopupRecordingStatus } from "@/hooks/use-popup-recording-status"
import { useUnfinishedCapture } from "@/hooks/use-unfinished-capture"
import {
  stopBackgroundRecording,
  stopFullPageScreenshot,
  toggleBackgroundRecordingPause,
} from "@/lib/background-recording/client"
import {
  HOTKEY_START_SCREENSHOT_CAPTURE_STORAGE_KEY,
  HOTKEY_START_VIDEO_CAPTURE_STORAGE_KEY,
} from "@/lib/capture-context"

function App() {
  const shortcuts = useCommandShortcuts()
  const {
    captureError,
    clearPendingCapture,
    isCapturing,
    pendingCaptureType,
    recordingCountdown: localRecordingCountdown,
    requestCapture,
    startCapture,
  } = usePopupCapture()
  const {
    isRecordingInProgress,
    recordingCountdown: syncedRecordingCountdown,
    recordingDurationMs,
    isRecordingPaused,
    isStoppingFromPopup,
    stopError,
    stopFromPopup,
    togglePauseFromPopup,
  } = usePopupRecordingStatus()
  const { micState, toggleMic } = usePopupMicToggle()
  const { pendingReview, recordingError, reopenReview } = useUnfinishedCapture()
  const fullPageProgress = useFullPageProgress()
  // "Record This Tab" records in the background, without a recorder tab.
  const { backgroundRecording, backgroundRecordedMs } =
    useBackgroundRecordingStatus()
  const isRecording = isRecordingInProgress || backgroundRecording !== null
  const isPaused = backgroundRecording
    ? backgroundRecording.pausedAt !== null
    : isRecordingPaused

  const recordingCountdown =
    localRecordingCountdown ?? syncedRecordingCountdown ?? null
  const error = stopError ?? captureError ?? recordingError
  const showUnsentReport = pendingReview !== null && !isRecording
  const isBusy = isCapturing || isStoppingFromPopup

  useHotkeyTrigger({
    storageKey: HOTKEY_START_VIDEO_CAPTURE_STORAGE_KEY,
    enabled: !isRecording,
    errorMessage: "Failed to start capture from hotkey popup flow",
    onTrigger: async () => {
      await startCapture("video")
    },
  })
  useHotkeyTrigger({
    storageKey: HOTKEY_START_SCREENSHOT_CAPTURE_STORAGE_KEY,
    enabled: !isRecording,
    errorMessage: "Failed to start screenshot capture from hotkey popup flow",
    onTrigger: async () => {
      await startCapture("screenshot")
    },
  })

  return (
    <div className="w-[360px] space-y-4 bg-linear-to-b from-slate-100 to-background p-3.5">
      <PopupHeader />

      {error ? (
        <div
          className="flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      ) : null}

      {showUnsentReport ? <UnsentReportCard onOpen={reopenReview} /> : null}

      <PopupCaptureActions
        fullPageProgress={fullPageProgress}
        hasFloatingBar={backgroundRecording !== null}
        hasUnsentReport={showUnsentReport}
        isBusy={isBusy}
        isRecordingInProgress={isRecording}
        isRecordingPaused={isPaused}
        micState={backgroundRecording?.micState ?? micState}
        onClearPendingCapture={clearPendingCapture}
        onRequestCapture={requestCapture}
        onStartCapture={startCapture}
        onStopFromPopup={
          backgroundRecording
            ? async () => {
                await stopBackgroundRecording()
                window.close()
              }
            : stopFromPopup
        }
        onStopFullPage={stopFullPageScreenshot}
        onToggleMic={toggleMic}
        onTogglePause={
          backgroundRecording
            ? () => toggleBackgroundRecordingPause(isPaused)
            : togglePauseFromPopup
        }
        pendingCaptureType={pendingCaptureType}
        recordingCountdown={recordingCountdown}
        recordingDurationMs={
          backgroundRecording ? backgroundRecordedMs : recordingDurationMs
        }
        startRecordingShortcut={shortcuts.startRecording}
        startScreenshotShortcut={shortcuts.startScreenshot}
        stopRecordingShortcut={shortcuts.stopRecording}
        togglePauseShortcut={shortcuts.togglePause}
      />

      <PopupFooter />
    </div>
  )
}

export default App
