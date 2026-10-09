import {
  buildDebuggerSubmissionPayload,
  hasDebuggerPayloadData,
  isDuringPause,
} from "@crikket/capture-core/debugger/payload"
import { readDebuggerSessionIdFromSearch } from "@crikket/capture-core/debugger/recorder-session"
import {
  findFirstReportPage,
  type ReportPage,
  suggestReportTitle,
} from "@crikket/capture-core/debugger/report-title"
import { trimDebuggerSnapshot } from "@crikket/capture-core/debugger/trim"
import type {
  BugReportDebuggerPayload,
  DebuggerSessionTab,
  RecordingPause,
} from "@crikket/capture-core/debugger/types"
import { env } from "@crikket/env/extension"
import type { Priority } from "@crikket/shared/constants/priorities"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { AlertCircle } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AllowMicrophoneStep } from "@/components/allow-microphone-step"
import { CapturePreview } from "@/components/capture-preview"
import { ChooseDisplayStep } from "@/components/choose-display-step"
import { CloseReviewButton } from "@/components/close-review-button"
import { EditStep } from "@/components/edit-step"
import { FormStep } from "@/components/form-step"
import { RecordingStep } from "@/components/recording-step"
import { ReviewShell } from "@/components/review-shell"
import { SuccessStep } from "@/components/success-step"
import { useCaptureContext } from "@/hooks/use-capture-context"
import { useCaptureEdits } from "@/hooks/use-capture-edits"
import { useCommandShortcuts } from "@/hooks/use-command-shortcuts"
import { type CaptureType, useRecorderInit } from "@/hooks/use-recorder-init"
import { useRecorderMicSync } from "@/hooks/use-recorder-mic-sync"
import { useRecorderRecordingSync } from "@/hooks/use-recorder-recording-sync"
import { useReviewRecording } from "@/hooks/use-review-recording"
import { useSavedReviewEdits } from "@/hooks/use-saved-review-edits"
import { useScreenCapture } from "@/hooks/use-screen-capture"
import { useTimer } from "@/hooks/use-timer"
import { closeRecorderWindow } from "@/lib/background-recording/client"
import {
  discardDebuggerSession,
  markDebuggerRecordingStarted,
  markDebuggerRecordingStopped,
  setDebuggerRecordingPaused,
} from "@/lib/bug-report-debugger/client"
import { submitBugReportWithUploads } from "@/lib/bug-report-upload"
import {
  type CaptureContext,
  readVideoSourceFromSearch,
} from "@/lib/capture-context"
import { loadDebuggerSnapshot } from "@/lib/load-debugger-snapshot"
import { isMicrophonePermissionUndecided } from "@/lib/microphone-permission"
import {
  buildCaptureContextSubmissionData,
  type DebuggerCaptureSummary,
  dedupeMessages,
  EMPTY_DEBUGGER_SUMMARY,
  getDebuggerCaptureSummary,
  getReportedTabs,
  getSubmissionErrorMessage,
  isUnauthorizedSubmissionError,
  normalizeOptionalText,
} from "@/lib/recorder-submit"
import type { FullPageDetails, StoredRecording } from "@/lib/recording-store"
import { formatDuration, getDeviceInfo } from "@/lib/utils"
import { alignDebuggerPayload, getSubmissionDurationMs } from "@/lib/video-edit"

type State =
  | "idle"
  | "recording"
  | "stopped"
  | "editing"
  | "submitting"
  | "success"

// The form stays mounted while editing so the typed title and description survive.
const FORM_STATES: ReadonlySet<State> = new Set([
  "stopped",
  "submitting",
  "editing",
])

// What the user captured, in messages about it.
// Closing throws the capture away, so it asks first, also while the capture
// loads; not once it was sent or failed to load.
function shouldConfirmDiscard(state: State, hasError: boolean): boolean {
  if (state === "success") return false
  return !(state === "idle" && hasError)
}

const CAPTURE_NOUNS: Record<CaptureType, string> = {
  video: "recording",
  screenshot: "screenshot",
}

// Editing happens after recording stopped, so other hooks treat it as "stopped".
const toSyncState = (state: State) => (state === "editing" ? "stopped" : state)

interface DebuggerSubmissionInput {
  sessionId: string | null
  payload: BugReportDebuggerPayload | undefined
  summary: DebuggerCaptureSummary
  tabs: DebuggerSessionTab[]
  suggestedTitle: string | null
  firstPage: ReportPage | null
  warnings: string[]
}

function App() {
  const shortcuts = useCommandShortcuts()
  const [state, setState] = useState<State>("idle")
  const [captureType, setCaptureType] = useState<CaptureType>("video")
  // Moved forward by the paused time on each resume, so now - startTime is
  // the length of the video so far.
  const [startTime, setStartTime] = useState<number | null>(null)
  const [pausedAt, setPausedAt] = useState<number | null>(null)
  // Toggle and stop read this, not the state: a second pause message can
  // arrive before React re-renders with the new pausedAt.
  const pausedAtRef = useRef<number | null>(null)
  const pausesRef = useRef<RecordingPause[]>([])
  const updatePausedAt = useCallback((value: number | null) => {
    pausedAtRef.current = value
    setPausedAt(value)
  }, [])
  // Same for the start time: Stop can arrive right after a Resume.
  const startTimeRef = useRef<number | null>(null)
  const updateStartTime = useCallback((value: number | null) => {
    startTimeRef.current = value
    setStartTime(value)
  }, [])
  const [recordedDurationMs, setRecordedDurationMs] = useState<number | null>(
    null
  )
  const [resultUrl, setResultUrl] = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submissionWarnings, setSubmissionWarnings] = useState<string[]>([])
  const [preSubmitWarnings, setPreSubmitWarnings] = useState<string[]>([])
  const [debuggerTitle, setDebuggerTitle] = useState<string | null>(null)
  const [isWaitingForStartClick, setIsWaitingForStartClick] = useState(false)
  // How a full-page screenshot went (screens, whether it is complete).
  const [fullPageDetails, setFullPageDetails] =
    useState<FullPageDetails | null>(null)
  // Pauses in a background recording; the video leaves them out.
  const [recordingPauses, setRecordingPauses] = useState<RecordingPause[]>([])
  const [debuggerSummary, setDebuggerSummary] =
    useState<DebuggerCaptureSummary>(EMPTY_DEBUGGER_SUMMARY)
  const {
    editedScreenshot,
    videoEdits,
    videoTrim,
    videoOverlays,
    screenshotEdits,
    setVideoTrim,
    setVideoOverlays,
    applyScreenshotEdits,
    resetEdits,
    restoreEdits,
    prepareAttachment,
  } = useCaptureEdits()
  const debuggerSessionId = useMemo(
    () => readDebuggerSessionIdFromSearch(window.location.search),
    []
  )

  // Tells the background to stop storing events while paused.
  const syncDebuggerPause = useCallback(
    (value: number | null) => {
      if (!debuggerSessionId) {
        return
      }

      setDebuggerRecordingPaused({
        sessionId: debuggerSessionId,
        pausedAt: value,
      }).catch((error: unknown) => {
        reportNonFatalError(
          `Failed to sync debugger pause for session ${debuggerSessionId}`,
          error
        )
      })
    },
    [debuggerSessionId]
  )

  const videoSource = useMemo(
    () => readVideoSourceFromSearch(window.location.search),
    []
  )

  const {
    startRecording: startCapture,
    stopRecording: stopCapture,
    pauseRecording: pauseCapture,
    resumeRecording: resumeCapture,
    takeScreenshot: captureScreenshot,
    recordedBlob,
    screenshotBlob,
    error: captureError,
    micState,
    reset: resetCapture,
    setRecordedBlob,
    setScreenshotBlob,
    toggleMic,
  } = useScreenCapture()
  const { isReview, forgetRecording, cancelReview } =
    useReviewRecording(debuggerSessionId)
  const captureContext = useCaptureContext({
    sessionId: debuggerSessionId,
    isReview,
  })
  useSavedReviewEdits({
    sessionId: debuggerSessionId,
    isReview,
    edits: { videoEdits, screenshotEdits, editedScreenshot },
    onRestore: restoreEdits,
  })

  const runningDuration = useTimer(
    startTime,
    state === "recording" && pausedAt === null
  )
  const duration = getShownDuration(startTime, pausedAt, runningDuration)

  const clearDebuggerState = useCallback(async () => {
    if (debuggerSessionId) {
      await discardDebuggerSession(debuggerSessionId).catch(
        (error: unknown) => {
          reportNonFatalError(
            "Failed to discard debugger session during reset",
            error
          )
        }
      )
    }
  }, [debuggerSessionId])

  const getDebuggerSubmissionInput = useCallback(async () => {
    const warnings: string[] = []
    const sessionId = debuggerSessionId
    if (!sessionId) {
      warnings.push(
        "Debugger session was not found. This report may be missing captured logs."
      )
      return {
        sessionId: null,
        payload: undefined,
        summary: EMPTY_DEBUGGER_SUMMARY,
        tabs: [],
        suggestedTitle: null,
        firstPage: null,
        warnings,
      } satisfies DebuggerSubmissionInput
    }

    const rawSnapshot = await loadDebuggerSnapshot(sessionId)

    if (!rawSnapshot) {
      warnings.push(
        "Debugger snapshot could not be loaded. This report may be missing captured logs."
      )
      return {
        sessionId,
        payload: undefined,
        summary: EMPTY_DEBUGGER_SUMMARY,
        tabs: [],
        suggestedTitle: null,
        firstPage: null,
        warnings,
      } satisfies DebuggerSubmissionInput
    }

    // Pauses made on this recorder page, or in a background recording.
    const pauses = [...pausesRef.current, ...recordingPauses]
    const snapshot = {
      ...rawSnapshot,
      events: rawSnapshot.events.filter(
        (event) => !isDuringPause(event.timestamp, pauses)
      ),
    }
    const payload = alignDebuggerPayload(
      buildDebuggerSubmissionPayload(snapshot, pauses),
      videoEdits
    )
    const summary = getDebuggerCaptureSummary(payload)
    const hasPayloadData = hasDebuggerPayloadData(payload)

    if (!hasPayloadData) {
      warnings.push(
        "No debugger events were captured yet. Reproduce the issue once before submitting if you need network/action logs."
      )
    } else if (summary.networkRequests === 0) {
      warnings.push(
        `No network requests were captured with this ${CAPTURE_NOUNS[captureType]}. API-level debugging data may be incomplete.`
      )
    }

    // The title and first page come from what the report keeps, so an error
    // that was trimmed out cannot name it.
    const reportSnapshot = videoEdits
      ? trimDebuggerSnapshot(
          snapshot,
          { startMs: videoEdits.trimStartMs, endMs: videoEdits.trimEndMs },
          pauses
        )
      : snapshot

    return {
      sessionId,
      payload: hasPayloadData ? payload : undefined,
      summary,
      tabs: getReportedTabs(snapshot.tabs, snapshot.captureTabId, payload),
      suggestedTitle: suggestReportTitle(reportSnapshot),
      firstPage: findFirstReportPage(reportSnapshot),
      warnings,
    } satisfies DebuggerSubmissionInput
  }, [captureType, debuggerSessionId, recordingPauses, videoEdits])

  // When the video ended. Sent once, before the report is built, so the
  // background stops following tabs and drops later events.
  const recordingStoppedAtRef = useRef<number | null>(null)
  const markStoppedPromiseRef = useRef<Promise<void> | null>(null)
  const markRecordingStopped = useCallback((): Promise<void> => {
    if (captureType !== "video" || !debuggerSessionId) {
      return Promise.resolve()
    }

    markStoppedPromiseRef.current ??= markDebuggerRecordingStopped({
      sessionId: debuggerSessionId,
      recordingStoppedAt: recordingStoppedAtRef.current ?? Date.now(),
    }).catch((error: unknown) => {
      reportNonFatalError(
        `Failed to mark debugger recording stop for session ${debuggerSessionId}`,
        error
      )
    })
    return markStoppedPromiseRef.current
  }, [captureType, debuggerSessionId])

  // Stopping while paused ends the video where the pause began.
  const getStoppedAt = useCallback(() => pausedAtRef.current ?? Date.now(), [])

  const finishRecording = useCallback(
    (stoppedAt: number) => {
      recordingStoppedAtRef.current ??= stoppedAt
      const recordingStartTime = startTimeRef.current
      if (recordingStartTime) {
        setRecordedDurationMs(Math.max(0, stoppedAt - recordingStartTime))
      }
      updatePausedAt(null)
      setState("stopped")
    },
    [updatePausedAt]
  )

  const handleStopRecording = useCallback(async () => {
    const stoppedAt = getStoppedAt()
    await stopCapture()
    finishRecording(stoppedAt)
  }, [finishRecording, getStoppedAt, stopCapture])

  const handleTogglePause = useCallback(() => {
    if (state !== "recording") {
      return
    }

    const now = Date.now()
    const pauseStart = pausedAtRef.current
    if (pauseStart === null) {
      pauseCapture()
      updatePausedAt(now)
      syncDebuggerPause(now)
      return
    }

    resumeCapture()
    pausesRef.current = [
      ...pausesRef.current,
      { pausedAt: pauseStart, resumedAt: now },
    ]
    const current = startTimeRef.current
    updateStartTime(current ? current + (now - pauseStart) : now)
    updatePausedAt(null)
    syncDebuggerPause(null)
  }, [
    pauseCapture,
    resumeCapture,
    state,
    syncDebuggerPause,
    updatePausedAt,
    updateStartTime,
  ])

  useRecorderRecordingSync({
    captureType,
    onStopFromPopup: handleStopRecording,
    onTogglePause: handleTogglePause,
    pausedAt,
    startTime,
    state: toSyncState(state),
  })

  useRecorderMicSync({
    isRecording: state === "recording",
    micState,
    onToggleMic: toggleMic,
  })

  const startVideoCapture = useCallback(async () => {
    const success = await startCapture(videoSource)
    if (success) {
      const startedAt = Date.now()
      const sessionId = debuggerSessionId
      if (sessionId) {
        await markDebuggerRecordingStarted({
          sessionId,
          recordingStartedAt: startedAt,
        }).catch((error: unknown) => {
          reportNonFatalError(
            `Failed to mark debugger recording start for session ${sessionId}`,
            error
          )
        })
      }

      updateStartTime(startedAt)
      updatePausedAt(null)
      pausesRef.current = []
      setRecordedDurationMs(null)
      setState("recording")
    }
  }, [
    debuggerSessionId,
    startCapture,
    updatePausedAt,
    videoSource,
    updateStartTime,
  ])

  const handleStartCapture = useCallback(async () => {
    if (captureType === "screenshot") {
      const blob = await captureScreenshot()
      if (blob) {
        setRecordedDurationMs(null)
        setState("stopped")
      }
      return
    }

    await startVideoCapture()
  }, [captureScreenshot, captureType, startVideoCapture])

  useEffect(() => {
    if (state === "recording" && recordedBlob) {
      // Chrome's "Stop sharing" ended the video.
      finishRecording(getStoppedAt())
    }
  }, [finishRecording, getStoppedAt, recordedBlob, state])

  useEffect(() => {
    if (state !== "stopped") {
      setPreSubmitWarnings([])
      return
    }

    let isCancelled = false

    markRecordingStopped()
      .then(() => getDebuggerSubmissionInput())
      .then((debuggerInput) => {
        if (isCancelled) {
          return
        }

        setDebuggerSummary(debuggerInput.summary)
        setDebuggerTitle(debuggerInput.suggestedTitle)
        setPreSubmitWarnings(debuggerInput.warnings)
      })
      .catch((error: unknown) => {
        reportNonFatalError(
          "Failed to inspect debugger data before bug report submission",
          error
        )
        if (isCancelled) {
          return
        }

        setDebuggerSummary(EMPTY_DEBUGGER_SUMMARY)
        setPreSubmitWarnings([
          "Could not validate debugger data before submitting.",
        ])
      })

    return () => {
      isCancelled = true
    }
  }, [getDebuggerSubmissionInput, markRecordingStopped, state])

  // The first recording waits for a click; see AllowMicrophoneStep.
  const startRecordingWhenReady = useCallback(async () => {
    if (await isMicrophonePermissionUndecided()) {
      setIsWaitingForStartClick(true)
      return
    }
    await handleStartCapture()
  }, [handleStartCapture])

  useRecorderInit({
    onCaptureTypeChange: setCaptureType,
    onRecordingLoaded: (recording: StoredRecording) => {
      setRecordedBlob(recording.blob)
      setRecordedDurationMs(recording.durationMs)
      setRecordingPauses(recording.pauses)
      recordingStoppedAtRef.current = recording.stoppedAt
      setState("stopped")
    },
    onScreenshotLoaded: (blob, fullPage) => {
      setScreenshotBlob(blob)
      setFullPageDetails(fullPage)
      setRecordedDurationMs(null)
      setState("stopped")
    },
    onStartRecording: startRecordingWhenReady,
    onError: (err) => setSubmitError(err),
  })

  const handleReset = () => {
    resetCapture()
    setDebuggerTitle(null)
    setState("idle")
    setResultUrl("")
    setSubmitError(null)
    setSubmissionWarnings([])
    setPreSubmitWarnings([])
    setDebuggerSummary(EMPTY_DEBUGGER_SUMMARY)
    setRecordedDurationMs(null)
    updateStartTime(null)
    updatePausedAt(null)
    pausesRef.current = []
    resetEdits()
    cancelReview()
    clearDebuggerState().catch((error: unknown) => {
      reportNonFatalError("Failed to clear debugger state after reset", error)
    })
  }

  const originalBlob = captureType === "video" ? recordedBlob : screenshotBlob
  // Video edits are applied on submit, so a video previews as recorded.
  const activeBlob = editedScreenshot ?? originalBlob
  const originalDurationMs =
    recordedDurationMs ?? (duration > 0 ? duration : null)

  const handleSubmit = async (values: {
    title: string
    description: string
    priority: Priority
  }) => {
    const blob = activeBlob
    if (!blob || blob.size === 0) {
      setSubmitError("Capture data is missing. Please capture again.")
      setState("stopped")
      return
    }

    setState("submitting")
    setSubmitError(null)
    setSubmissionWarnings([])

    try {
      const durationMs = getSubmissionDurationMs({
        captureType,
        videoEdits,
        recordedDurationMs,
        startTime,
      })
      await markRecordingStopped()
      const debuggerSubmission = await getDebuggerSubmissionInput()
      const captureContextSubmissionData = buildCaptureContextSubmissionData(
        getReportPageContext(captureContext, debuggerSubmission.firstPage)
      )
      const warnings = [
        ...debuggerSubmission.warnings,
        ...captureContextSubmissionData.warnings,
      ]

      const attachment = await prepareAttachment(
        captureType,
        blob,
        originalDurationMs ?? 0
      )
      const result = await submitBugReportWithUploads({
        attachment,
        attachmentType: captureType,
        title: normalizeOptionalText(values.title, 200),
        priority: values.priority,
        description: normalizeOptionalText(values.description, 3000),
        url: captureContextSubmissionData.normalizedUrl,
        metadata: {
          duration: formatDuration(durationMs),
          durationMs,
          pageTitle: captureContextSubmissionData.normalizedPageTitle,
          tabs: debuggerSubmission.tabs.map((tab) => ({
            tabId: tab.tabId,
            url: tab.url,
            title: tab.title,
          })),
        },
        deviceInfo: getDeviceInfo(),
        debuggerPayload: debuggerSubmission.payload,
        debuggerSummary: debuggerSubmission.summary,
      })

      if (debuggerSubmission.sessionId) {
        await discardDebuggerSession(debuggerSubmission.sessionId).catch(
          (error: unknown) => {
            reportNonFatalError(
              `Failed to discard debugger session ${debuggerSubmission.sessionId} after submission`,
              error
            )
          }
        )
      }

      setResultUrl(`${env.VITE_APP_URL}${result.shareUrl}`)
      setSubmissionWarnings(
        dedupeMessages([...warnings, ...(result.warnings ?? [])])
      )
      setState("success")
      forgetRecording()
    } catch (error) {
      if (isUnauthorizedSubmissionError(error)) {
        const loginUrl = new URL("/login", env.VITE_APP_URL).toString()
        window.open(loginUrl, "_blank", "noopener,noreferrer")
      }
      setSubmitError(getSubmissionErrorMessage(error, captureType))
      setState("stopped")
    }
  }

  const suggestedTitle =
    debuggerTitle ||
    (isWebPageUrl(captureContext.url) ? captureContext.title?.trim() : "") ||
    (captureType === "video" ? "Video bug report" : "Screenshot bug report")
  const previewUrl = useMemo(() => {
    if (!activeBlob) return null
    return URL.createObjectURL(activeBlob)
  }, [activeBlob])

  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const error = captureError || submitError
  const isChoosingDisplay = captureType === "video" && videoSource === "display"
  const idleMode = getIdleMode(isChoosingDisplay, isWaitingForStartClick)

  useEffect(() => {
    if (state === "recording") {
      document.title = `${pausedAt === null ? "Recording" : "Paused"} ${formatDuration(duration)} - Crikket`
      return
    }

    document.title = "Crikket Bug Report"
  }, [duration, pausedAt, state])

  return (
    <ReviewShell
      closeButton={
        <CloseReviewButton
          captureLabel={CAPTURE_NOUNS[captureType]}
          closeOnEscape={state !== "editing" && state !== "submitting"}
          confirmDiscard={shouldConfirmDiscard(state, Boolean(error))}
          isVisible={isReview}
          onClose={state === "success" ? closeRecorderWindow : handleReset}
          onDiscard={handleReset}
        />
      }
      wide={fullPageDetails !== null}
    >
      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="font-medium text-sm">{error}</span>
        </div>
      ) : null}

      {state === "idle" ? (
        <IdleStep mode={idleMode} onStart={handleStartCapture} />
      ) : null}

      {state === "recording" ? (
        <RecordingStep
          duration={duration}
          isPaused={pausedAt !== null}
          micState={micState}
          onStopRecording={handleStopRecording}
          onToggleMic={toggleMic}
          onTogglePause={handleTogglePause}
          stopRecordingShortcut={shortcuts.stopRecording}
          togglePauseShortcut={shortcuts.togglePause}
        />
      ) : null}

      {state === "editing" ? (
        <EditStep
          captureType={captureType}
          durationMs={originalDurationMs ?? 0}
          isLongScreenshot={fullPageDetails !== null}
          onCancel={() => setState("stopped")}
          onScreenshotEditsApplied={(result) => {
            applyScreenshotEdits(result)
            setState("stopped")
          }}
          onVideoOverlaysApplied={(overlays) => {
            setVideoOverlays(overlays, originalDurationMs ?? 0)
            setState("stopped")
          }}
          originalBlob={originalBlob}
          screenshotEdits={screenshotEdits}
          screenshotPixelRatio={fullPageDetails?.scale}
          trim={videoTrim}
          videoOverlays={videoOverlays}
        />
      ) : null}

      {FORM_STATES.has(state) ? (
        <div hidden={state === "editing"}>
          <FormStep
            captureLabel={CAPTURE_NOUNS[captureType]}
            debuggerSummary={debuggerSummary}
            initialTitle={suggestedTitle}
            isSubmitting={state === "submitting"}
            onCancel={handleReset}
            onSubmit={handleSubmit}
            preSubmitWarnings={preSubmitWarnings}
            preview={
              <CapturePreview
                captureType={captureType}
                disabled={state === "submitting"}
                durationMs={originalDurationMs}
                fullPage={fullPageDetails}
                isScreenshotEdited={editedScreenshot !== null}
                onEdit={() => setState("editing")}
                onTrimChange={setVideoTrim}
                previewUrl={previewUrl}
                videoEdits={videoEdits}
              />
            }
            submitError={submitError}
          />
        </div>
      ) : null}

      {state === "success" ? (
        <SuccessStep
          onClose={closeRecorderWindow}
          onCopyLink={() => navigator.clipboard.writeText(resultUrl)}
          onOpenRecording={() => window.open(resultUrl, "_blank")}
          warnings={submissionWarnings}
        />
      ) : null}
    </ReviewShell>
  )
}

// While paused, show the exact paused time, as the popup does.
function getShownDuration(
  startTime: number | null,
  pausedAt: number | null,
  runningDuration: number
): number {
  return pausedAt !== null && startTime ? pausedAt - startTime : runningDuration
}

function isWebPageUrl(url: string | undefined): boolean {
  return Boolean(url?.startsWith("http://") || url?.startsWith("https://"))
}

// A recording started on a new-tab or other browser page reports the first
// website the user went to instead.
function getReportPageContext(
  captureContext: CaptureContext,
  firstPage: ReportPage | null
): CaptureContext {
  if (isWebPageUrl(captureContext.url) || !firstPage) {
    return captureContext
  }

  return { url: firstPage.url, title: firstPage.title }
}

// What the recorder tab shows before recording starts.
type IdleMode = "choose-display" | "allow-microphone" | "waiting"

function getIdleMode(
  isChoosingDisplay: boolean,
  isWaitingForStartClick: boolean
): IdleMode {
  if (isChoosingDisplay) return "choose-display"
  if (isWaitingForStartClick) return "allow-microphone"
  return "waiting"
}

function IdleStep({
  mode,
  onStart,
}: {
  mode: IdleMode
  onStart: () => Promise<void>
}) {
  if (mode === "choose-display") {
    return <ChooseDisplayStep onChoose={onStart} />
  }

  if (mode === "allow-microphone") {
    return <AllowMicrophoneStep onStart={onStart} />
  }

  return (
    <p className="text-center text-muted-foreground">
      No active capture. Start from the extension popup.
    </p>
  )
}

export default App
