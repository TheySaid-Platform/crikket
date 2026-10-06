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
import type {
  BugReportDebuggerPayload,
  DebuggerSessionTab,
  RecordingPause,
} from "@crikket/capture-core/debugger/types"
import { env } from "@crikket/env/extension"
import type { Priority } from "@crikket/shared/constants/priorities"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import { AlertCircle } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChooseDisplayStep } from "@/components/choose-display-step"
import { FormStep } from "@/components/form-step"
import { RecordingStep } from "@/components/recording-step"
import { SuccessStep } from "@/components/success-step"
import { useCaptureContext } from "@/hooks/use-capture-context"
import { useCommandShortcuts } from "@/hooks/use-command-shortcuts"
import { type CaptureType, useRecorderInit } from "@/hooks/use-recorder-init"
import { useRecorderRecordingSync } from "@/hooks/use-recorder-recording-sync"
import { useScreenCapture } from "@/hooks/use-screen-capture"
import { useTimer } from "@/hooks/use-timer"
import {
  discardDebuggerSession,
  getDebuggerSessionSnapshot,
  markDebuggerRecordingStarted,
  markDebuggerRecordingStopped,
} from "@/lib/bug-report-debugger/client"
import { submitBugReportWithUploads } from "@/lib/bug-report-upload"
import {
  type CaptureContext,
  readVideoSourceFromSearch,
} from "@/lib/capture-context"
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
import { formatDuration, getDeviceInfo } from "@/lib/utils"

type State = "idle" | "recording" | "stopped" | "submitting" | "success"

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
  const pausesRef = useRef<RecordingPause[]>([])
  const [recordedDurationMs, setRecordedDurationMs] = useState<number | null>(
    null
  )
  const [resultUrl, setResultUrl] = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submissionWarnings, setSubmissionWarnings] = useState<string[]>([])
  const [preSubmitWarnings, setPreSubmitWarnings] = useState<string[]>([])
  const [debuggerTitle, setDebuggerTitle] = useState<string | null>(null)
  const [debuggerSummary, setDebuggerSummary] =
    useState<DebuggerCaptureSummary>(EMPTY_DEBUGGER_SUMMARY)
  const debuggerSessionId = useMemo(
    () => readDebuggerSessionIdFromSearch(window.location.search),
    []
  )

  const videoSource = useMemo(
    () => readVideoSourceFromSearch(window.location.search),
    []
  )

  const captureContext = useCaptureContext()

  const {
    startRecording: startCapture,
    stopRecording: stopCapture,
    pauseRecording: pauseCapture,
    resumeRecording: resumeCapture,
    takeScreenshot: captureScreenshot,
    recordedBlob,
    screenshotBlob,
    error: captureError,
    reset: resetCapture,
    setScreenshotBlob,
  } = useScreenCapture()

  const duration = useTimer(
    startTime,
    state === "recording" && pausedAt === null
  )

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

    const rawSnapshot = await getDebuggerSessionSnapshot(sessionId).catch(
      (error: unknown) => {
        reportNonFatalError(
          `Failed to load debugger snapshot for session ${sessionId}`,
          error
        )
        return null
      }
    )

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

    const pauses = pausesRef.current
    const snapshot = {
      ...rawSnapshot,
      events: rawSnapshot.events.filter(
        (event) => !isDuringPause(event.timestamp, pauses)
      ),
    }
    const payload = buildDebuggerSubmissionPayload(snapshot, pauses)
    const summary = getDebuggerCaptureSummary(payload)
    const hasPayloadData = hasDebuggerPayloadData(payload)

    if (!hasPayloadData) {
      warnings.push(
        "No debugger events were captured yet. Reproduce the issue once before submitting if you need network/action logs."
      )
    } else if (summary.networkRequests === 0) {
      warnings.push(
        "No network requests were captured in this recording. API-level debugging data may be incomplete."
      )
    }

    return {
      sessionId,
      payload: hasPayloadData ? payload : undefined,
      summary,
      tabs: getReportedTabs(snapshot.tabs, snapshot.captureTabId, payload),
      suggestedTitle: suggestReportTitle(snapshot),
      firstPage: findFirstReportPage(snapshot),
      warnings,
    } satisfies DebuggerSubmissionInput
  }, [debuggerSessionId])

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
  const getStoppedAt = useCallback(() => pausedAt ?? Date.now(), [pausedAt])

  const finishRecording = useCallback(
    (stoppedAt: number) => {
      recordingStoppedAtRef.current ??= stoppedAt
      if (startTime) {
        setRecordedDurationMs(Math.max(0, stoppedAt - startTime))
      }
      setPausedAt(null)
      setState("stopped")
    },
    [startTime]
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
    if (pausedAt === null) {
      pauseCapture()
      setPausedAt(now)
      return
    }

    resumeCapture()
    pausesRef.current = [...pausesRef.current, { pausedAt, resumedAt: now }]
    setStartTime((current) => (current ? current + (now - pausedAt) : now))
    setPausedAt(null)
  }, [pauseCapture, pausedAt, resumeCapture, state])

  useRecorderRecordingSync({
    captureType,
    onStopFromPopup: handleStopRecording,
    onTogglePause: handleTogglePause,
    pausedAt,
    startTime,
    state,
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

      setStartTime(startedAt)
      setPausedAt(null)
      pausesRef.current = []
      setRecordedDurationMs(null)
      setState("recording")
    }
  }, [debuggerSessionId, startCapture, videoSource])

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

  useRecorderInit({
    onCaptureTypeChange: setCaptureType,
    onScreenshotLoaded: (blob) => {
      setScreenshotBlob(blob)
      setRecordedDurationMs(null)
      setState("stopped")
    },
    onStartRecording: handleStartCapture,
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
    setStartTime(null)
    setPausedAt(null)
    pausesRef.current = []
    clearDebuggerState().catch((error: unknown) => {
      reportNonFatalError("Failed to clear debugger state after reset", error)
    })
  }

  const handleSubmit = async (values: {
    title: string
    description: string
    priority: Priority
  }) => {
    const blob = captureType === "video" ? recordedBlob : screenshotBlob
    if (!blob || blob.size === 0) {
      setSubmitError("Capture data is missing. Please capture again.")
      setState("stopped")
      return
    }

    setState("submitting")
    setSubmitError(null)
    setSubmissionWarnings([])

    try {
      const durationMs =
        captureType === "video"
          ? Math.max(
              0,
              recordedDurationMs ?? (startTime ? Date.now() - startTime : 0)
            )
          : 0
      await markRecordingStopped()
      const debuggerSubmission = await getDebuggerSubmissionInput()
      const captureContextSubmissionData = buildCaptureContextSubmissionData(
        getReportPageContext(captureContext, debuggerSubmission.firstPage)
      )
      const warnings = [
        ...debuggerSubmission.warnings,
        ...captureContextSubmissionData.warnings,
      ]

      const result = await submitBugReportWithUploads({
        attachment: blob,
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
    } catch (error) {
      if (isUnauthorizedSubmissionError(error)) {
        const loginUrl = new URL("/login", env.VITE_APP_URL).toString()
        window.open(loginUrl, "_blank", "noopener,noreferrer")
      }
      setSubmitError(getSubmissionErrorMessage(error))
      setState("stopped")
    }
  }

  const activeBlob = captureType === "video" ? recordedBlob : screenshotBlob
  const suggestedTitle =
    debuggerTitle ||
    (isWebPageUrl(captureContext.url) ? captureContext.title?.trim() : "") ||
    (captureType === "video" ? "Video bug report" : "Screenshot bug report")
  const previewUrl = useMemo(() => {
    if (!activeBlob) return null
    return URL.createObjectURL(activeBlob)
  }, [activeBlob])

  const error = captureError || submitError
  const isChoosingDisplay = captureType === "video" && videoSource === "display"

  useEffect(() => {
    if (state === "recording") {
      document.title = `${pausedAt === null ? "Recording" : "Paused"} ${formatDuration(duration)} - Crikket`
      return
    }

    document.title = "Crikket Bug Report"
  }, [duration, pausedAt, state])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100/80 p-6 sm:p-8">
      <Card className="w-full max-w-3xl border-border/80 shadow-lg shadow-slate-950/5">
        <CardHeader className="gap-2 border-b bg-muted/20 text-left">
          <CardTitle className="flex items-center gap-2 text-xl sm:text-2xl">
            Crikket Bug Report
          </CardTitle>
          <CardDescription className="text-sm">
            {getStatusLabel(state, isChoosingDisplay, pausedAt !== null)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 px-6 py-6">
          {error ? (
            <div className="flex items-center gap-2 rounded-md bg-destructive/15 p-4 text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium text-sm">{error}</span>
            </div>
          ) : null}

          {state === "idle" ? (
            <IdleStep
              isChoosingDisplay={isChoosingDisplay}
              onChooseDisplay={handleStartCapture}
            />
          ) : null}

          {state === "recording" ? (
            <RecordingStep
              duration={duration}
              isPaused={pausedAt !== null}
              onStopRecording={handleStopRecording}
              onTogglePause={handleTogglePause}
              stopRecordingShortcut={shortcuts.stopRecording}
              togglePauseShortcut={shortcuts.togglePause}
            />
          ) : null}

          {state === "stopped" || state === "submitting" ? (
            <FormStep
              captureType={captureType}
              debuggerSummary={debuggerSummary}
              initialTitle={suggestedTitle}
              isSubmitting={state === "submitting"}
              onCancel={handleReset}
              onSubmit={handleSubmit}
              preSubmitWarnings={preSubmitWarnings}
              previewUrl={previewUrl}
              submitError={submitError}
              videoDurationMs={
                captureType === "video"
                  ? (recordedDurationMs ?? (duration > 0 ? duration : null))
                  : null
              }
            />
          ) : null}

          {state === "success" ? (
            <SuccessStep
              onClose={() => window.close()}
              onCopyLink={() => navigator.clipboard.writeText(resultUrl)}
              onOpenRecording={() => window.open(resultUrl, "_blank")}
              warnings={submissionWarnings}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
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

function getStatusLabel(
  state: State,
  isChoosingDisplay: boolean,
  isPaused: boolean
): string {
  switch (state) {
    case "idle":
      return isChoosingDisplay ? "Share your screen" : "Waiting for capture"
    case "recording":
      return isPaused ? "Recording paused" : "Recording in progress..."
    case "stopped":
      return "Review and submit"
    case "success":
      return "Report submitted!"
    default:
      return ""
  }
}

function IdleStep({
  isChoosingDisplay,
  onChooseDisplay,
}: {
  isChoosingDisplay: boolean
  onChooseDisplay: () => Promise<void>
}) {
  if (isChoosingDisplay) {
    return <ChooseDisplayStep onChoose={onChooseDisplay} />
  }

  return (
    <p className="text-center text-muted-foreground">
      No active capture. Start from the extension popup.
    </p>
  )
}

export default App
