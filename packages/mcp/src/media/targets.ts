import { formatOffset } from "../format"

/** A step's frame is taken a little after the step, to show what it did. */
export const STEP_FRAME_DELAY_MS = 700

const CLOCK_PATTERN = /^(?:(\d+):)?(\d+):(\d{1,2}(?:\.\d+)?)$/
const SECONDS_PATTERN = /^(\d+(?:\.\d+)?)\s*s$/i
const MILLISECONDS_PATTERN = /^(\d+)\s*ms$/i
const PLAIN_NUMBER_PATTERN = /^\d+(?:\.\d+)?$/
const STEP_PATTERN = /^step\s*[:#]?\s*(\d+)$/i

export type FrameRequest = string | number

export interface FrameTarget {
  /** What the caller asked for, e.g. "1:05" or "step:7". */
  label: string
  offsetMs: number
  step: number | null
}

export type FrameTargetResult =
  | { ok: true; target: FrameTarget }
  | { ok: false; label: string; message: string }

/**
 * Turns "1:05", "1:05.3", "45s", "1500ms", 45 (seconds) or "step:7" into an
 * offset in the video. Step numbers are the ones get_reproduction_steps and
 * get_bug_context show.
 */
export function resolveFrameTarget(
  request: FrameRequest,
  stepOffsets: (number | null)[]
): FrameTargetResult {
  const label = String(request).trim()

  const stepMatch = STEP_PATTERN.exec(label)
  if (stepMatch) {
    const step = Number(stepMatch[1])
    const stepOffset = stepOffsets[step - 1]
    if (stepOffset === undefined) {
      return {
        ok: false,
        label,
        message: `There is no step ${step}; this report has ${stepOffsets.length} steps.`,
      }
    }
    if (stepOffset === null) {
      return {
        ok: false,
        label,
        message: `Step ${step} happened before the recording started, so it is not in the video.`,
      }
    }
    return {
      ok: true,
      target: { label, offsetMs: stepOffset + STEP_FRAME_DELAY_MS, step },
    }
  }

  const offsetMs = parseTimeMs(request)
  if (offsetMs === null) {
    return {
      ok: false,
      label,
      message: `"${label.slice(0, 40)}" is not a time or step. Use a time like "1:05", "45s" or 45, or a step like "step:7".`,
    }
  }

  return { ok: true, target: { label, offsetMs, step: null } }
}

function parseTimeMs(request: FrameRequest): number | null {
  if (typeof request === "number") {
    return Number.isFinite(request) && request >= 0
      ? Math.round(request * 1000)
      : null
  }

  const value = request.trim()

  const clock = CLOCK_PATTERN.exec(value)
  if (clock) {
    const hours = Number(clock[1] ?? 0)
    const minutes = Number(clock[2])
    const seconds = Number(clock[3])
    if (seconds >= 60) {
      return null
    }
    return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1000)
  }

  const seconds =
    SECONDS_PATTERN.exec(value) ?? PLAIN_NUMBER_PATTERN.exec(value)
  if (seconds) {
    return Math.round(Number(seconds[1] ?? seconds[0]) * 1000)
  }

  const milliseconds = MILLISECONDS_PATTERN.exec(value)
  if (milliseconds) {
    return Number(milliseconds[1])
  }

  return null
}

export function describeTarget(target: FrameTarget): string {
  const time = formatOffset(target.offsetMs)
  return target.step === null
    ? `${target.label} (${time})`
    : `step ${target.step} (${time}, just after the step)`
}
