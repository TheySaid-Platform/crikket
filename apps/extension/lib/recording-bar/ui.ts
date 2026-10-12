import { DEFAULT_ANNOTATION_COLOR } from "@/lib/annotations"
import {
  type BackgroundRecordingState,
  getRecordedMs,
} from "@/lib/background-recording/protocol"
import { BAR_STYLES, type BarMode, createRecordingBar } from "./bar"
import { createBlurPicker } from "./blur-picker"
import { createDrawLayer, type LiveDrawTool } from "./draw-layer"

const HOST_ID = "crikket-recording-bar"
const TIMER_INTERVAL_MS = 250

// "You're muted" shows when the user talks into a muted mic for a moment.
const SPEECH_LEVEL = 0.32
const SPEECH_MIN_MS = 350

const MODE_HINTS: Record<Exclude<BarMode, "none">, string> = {
  draw: "Draw on the page with the tools above the bar. Drawings fade after a few seconds. Press Esc when done.",
  blur: "Click anything private to blur it, click again to unblur. Press Esc when done.",
}

// A constructed stylesheet is not subject to the page's Content Security
// Policy, unlike a <style> element (the fallback for older engines).
function applyStyles(shadow: ShadowRoot): void {
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(BAR_STYLES)
    shadow.adoptedStyleSheets = [sheet]
  } catch {
    const style = document.createElement("style")
    style.textContent = BAR_STYLES
    shadow.append(style)
  }
}

export interface RecordingCommands {
  stop: () => void
  pause: () => void
  resume: () => void
  toggleMic: () => void
  dismissMutedWarning: () => void
}

export interface RecordingUi {
  update: (state: BackgroundRecordingState) => void
  // 0 (silence) to 1 (loud), streamed from the offscreen recorder.
  setMicLevel: (level: number) => void
  destroy: () => void
}

// Everything lives in a closed shadow root on a click-through layer, so the
// page's styles cannot change the bar and the page stays usable around it.
export function createRecordingUi(commands: RecordingCommands): RecordingUi {
  document.getElementById(HOST_ID)?.remove()

  const host = document.createElement("div")
  host.id = HOST_ID
  host.style.cssText =
    "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;"
  const shadow = host.attachShadow({ mode: "closed" })
  applyStyles(shadow)

  let mode: BarMode = "none"
  let drawTool: LiveDrawTool = "pen"
  let drawColor = DEFAULT_ANNOTATION_COLOR
  let state: BackgroundRecordingState | null = null

  const drawLayer = createDrawLayer(shadow)
  const blurPicker = createBlurPicker(shadow, (element) => element === host)
  const hint = document.createElement("div")
  hint.className = "hint"
  hint.hidden = true
  shadow.append(hint)

  // Some pages rebuild their whole document (single-page apps, document.open),
  // which removes the bar; put it back.
  const attach = () => {
    if (!host.isConnected) {
      document.documentElement?.append(host)
    }
  }

  // The warning stays up until the user unmutes or closes it. Closing it
  // means no more reminders for this recording.
  let loudSince: number | null = null
  let isWarningShown = false
  const canWarn = () =>
    state?.micState === "off" && state.mutedWarningDismissed !== true

  const setMicLevel = (level: number) => {
    bar.setMicLevel(level)
    if (isWarningShown || !canWarn() || level < SPEECH_LEVEL) {
      loudSince = null
      return
    }

    const now = Date.now()
    loudSince ??= now
    if (now - loudSince >= SPEECH_MIN_MS) {
      isWarningShown = true
      bar.showMutedWarning()
    }
  }

  const render = () => {
    attach()
    if (!state) return
    bar.update({
      recordedMs: getRecordedMs(state, Date.now()),
      isPaused: state.pausedAt !== null,
      micState: state.micState,
      mode,
      drawTool,
      drawColor,
    })
  }

  // Picking the active tool again turns it off.
  const toggleMode = (next: Exclude<BarMode, "none">) => {
    mode = mode === next ? "none" : next
    drawLayer.setActive(mode === "draw")
    blurPicker.setActive(mode === "blur")
    hint.hidden = mode === "none"
    hint.textContent = mode === "none" ? "" : MODE_HINTS[mode]
    render()
  }

  const bar = createRecordingBar({
    onStop: commands.stop,
    onPause: commands.pause,
    onResume: commands.resume,
    onToggleMic: commands.toggleMic,
    onToggleDraw: () => toggleMode("draw"),
    onToggleBlur: () => toggleMode("blur"),
    onDrawToolChange: (tool) => {
      drawTool = tool
      drawLayer.setTool(tool)
      render()
    },
    onDrawColorChange: (color) => {
      drawColor = color
      drawLayer.setColor(color)
      render()
    },
    onDrawUndo: drawLayer.undo,
    onDrawClear: drawLayer.clear,
    onDismissMutedWarning: commands.dismissMutedWarning,
  })
  shadow.append(bar.element)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && mode !== "none") {
      event.stopPropagation()
      toggleMode(mode)
    }
  }
  window.addEventListener("keydown", onKeyDown, true)

  const timer = window.setInterval(render, TIMER_INTERVAL_MS)
  attach()

  return {
    update: (next) => {
      state = next
      if (!canWarn()) {
        isWarningShown = false
        bar.hideMutedWarning()
      }
      render()
    },
    setMicLevel,
    destroy: () => {
      window.clearInterval(timer)
      window.removeEventListener("keydown", onKeyDown, true)
      blurPicker.clearAll()
      blurPicker.destroy()
      drawLayer.destroy()
      host.remove()
    },
  }
}
