import type { MicState } from "@/hooks/use-screen-capture"
import { createButton, createDivider, setLabel } from "./dom"
import type { LiveDrawTool } from "./draw-layer"
import { createDrawPalette, DRAW_PALETTE_STYLES } from "./draw-palette"
import { ICONS } from "./icons"

export type BarMode = "none" | "draw" | "blur"

export interface BarState {
  recordedMs: number
  isPaused: boolean
  micState: MicState
  mode: BarMode
  drawTool: LiveDrawTool
  drawColor: string
}

export interface BarActions {
  onStop: () => void
  onPause: () => void
  onResume: () => void
  onToggleMic: () => void
  onToggleDraw: () => void
  onToggleBlur: () => void
  onDrawToolChange: (tool: LiveDrawTool) => void
  onDrawColorChange: (color: string) => void
  onDrawUndo: () => void
  onDrawClear: () => void
  // The user closed "You're muted" and wants no more reminders.
  onDismissMutedWarning: () => void
}

export interface RecordingBar {
  element: HTMLElement
  update: (state: BarState) => void
  // 0 (silence) to 1 (loud), from the offscreen recorder.
  setMicLevel: (level: number) => void
  showMutedWarning: () => void
  hideMutedWarning: () => void
}

// Relative heights of the four meter bars.
const METER_SHAPE = [0.55, 1, 0.75, 0.4]
const METER_MAX_PX = 16
const METER_MIN_PX = 3

export const BAR_STYLES = `
.bar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px;
  border-radius: 18px;
  background: rgba(17, 17, 21, 0.86);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  backdrop-filter: blur(14px) saturate(160%);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color: #fafafa;
  font: 500 14px/1 "Geist Variable", Geist, Inter, ui-sans-serif, system-ui, sans-serif;
  pointer-events: auto;
  user-select: none;
  cursor: grab;
  touch-action: none;
  animation: bar-enter 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.bar.dragging { cursor: grabbing; }
@keyframes bar-enter {
  from { opacity: 0; transform: translate(-50%, 12px) scale(0.96); }
  to { opacity: 1; transform: translate(-50%, 0) scale(1); }
}
.button {
  all: unset;
  position: relative;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  border-radius: 12px;
  color: rgba(255, 255, 255, 0.86);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
.button:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.button:active { transform: scale(0.92); }
.button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 1px; }
.button[aria-pressed="true"] {
  background: #fff;
  color: #111115;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}
.button:disabled { opacity: 0.4; cursor: not-allowed; background: none; transform: none; }
[data-tip]:hover::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 9px;
  border-radius: 8px;
  background: rgba(17, 17, 21, 0.96);
  color: #fff;
  font: 500 12px/1 system-ui, sans-serif;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
  pointer-events: none;
  z-index: 1;
}
.stop-square {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  background: #f43f5e;
  box-shadow: 0 0 0 4px rgba(244, 63, 94, 0.2);
  transition: transform 0.15s ease;
}
.button:hover .stop-square { transform: scale(1.1); }
.timer {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 8px;
  font: 600 14px/1 "Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f43f5e;
  animation: dot-pulse 1.6s ease-in-out infinite;
}
.bar.paused .dot { background: #f59e0b; animation: none; }
.bar.paused .time { opacity: 0.55; }
@keyframes dot-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.55); }
  50% { box-shadow: 0 0 0 5px rgba(244, 63, 94, 0); }
}
.meter {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 16px;
}
.meter span {
  width: 3px;
  height: ${METER_MIN_PX}px;
  border-radius: 2px;
  background: #34d399;
  transition: height 0.08s linear, background 0.15s ease;
}
.meter.muted span { background: rgba(251, 113, 133, 0.9); }
.meter.unavailable span { background: rgba(255, 255, 255, 0.25); }
.divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: rgba(255, 255, 255, 0.12);
}
svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
svg.filled { fill: currentColor; stroke: none; }
.above {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: default;
}
.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 6px 6px 12px;
  border-radius: 14px;
  background: #fff;
  color: #111;
  font: 500 13px/1.2 system-ui, sans-serif;
  white-space: nowrap;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
  animation: pop-in 0.2s ease;
}
.toast[hidden] { display: none; }
.toast > svg { width: 16px; height: 16px; color: #e11d48; }
.toast .unmute {
  all: unset;
  padding: 6px 10px;
  border-radius: 9px;
  background: #111;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
.toast .unmute:hover { background: #333; }
.toast-close {
  all: unset;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  color: #71717a;
  cursor: pointer;
}
.toast-close:hover { background: #f4f4f5; color: #111; }
.toast-close svg { width: 15px; height: 15px; }
@keyframes pop-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.hint {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 9px 14px;
  border-radius: 12px;
  background: rgba(17, 17, 21, 0.88);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.09);
  color: #fff;
  font: 500 13px/1.4 system-ui, sans-serif;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
  pointer-events: none;
}
${DRAW_PALETTE_STYLES}
`

function formatRecordedTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, "0")
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`
}

// Lets the user move the bar out of the way by dragging its background.
function makeDraggable(bar: HTMLElement): void {
  bar.addEventListener("pointerdown", (event) => {
    const target = event.target as HTMLElement
    if (target.closest(".button, .above")) return

    const rect = bar.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    bar.setPointerCapture(event.pointerId)
    bar.classList.add("dragging")

    const onMove = (moveEvent: PointerEvent) => {
      const left = Math.min(
        Math.max(0, moveEvent.clientX - offsetX),
        window.innerWidth - rect.width
      )
      const top = Math.min(
        Math.max(0, moveEvent.clientY - offsetY),
        window.innerHeight - rect.height
      )
      bar.style.transform = "none"
      bar.style.bottom = "auto"
      bar.style.left = `${left}px`
      bar.style.top = `${top}px`
    }
    const onUp = () => {
      bar.classList.remove("dragging")
      bar.removeEventListener("pointermove", onMove)
      bar.removeEventListener("pointerup", onUp)
    }
    bar.addEventListener("pointermove", onMove)
    bar.addEventListener("pointerup", onUp)
  })
}

// "You're muted", shown when the user talks into a muted microphone.
function createMutedToast(actions: {
  onUnmute: () => void
  onDismiss: () => void
}): HTMLElement {
  const toast = document.createElement("div")
  toast.className = "toast"
  toast.setAttribute("role", "status")
  toast.hidden = true
  toast.innerHTML = `${ICONS.micOff}<span>You're muted</span>`

  const unmute = document.createElement("button")
  unmute.type = "button"
  unmute.className = "unmute"
  unmute.textContent = "Unmute"
  unmute.addEventListener("click", (event) => {
    event.stopPropagation()
    toast.hidden = true
    actions.onUnmute()
  })

  const close = document.createElement("button")
  close.type = "button"
  close.className = "toast-close"
  close.innerHTML = ICONS.close
  setLabel(close, "Don't remind me again")
  close.addEventListener("click", (event) => {
    event.stopPropagation()
    toast.hidden = true
    actions.onDismiss()
  })

  toast.append(unmute, close)
  return toast
}

function getMicLabel(micState: MicState): string {
  if (micState === "on") return "Mute microphone"
  if (micState === "off") return "Unmute microphone"
  return "Microphone not available"
}

export function createRecordingBar(actions: BarActions): RecordingBar {
  const bar = document.createElement("div")
  bar.className = "bar"
  bar.setAttribute("role", "toolbar")
  bar.setAttribute("aria-label", "Crikket recording controls")

  let latest: BarState | null = null

  const stopButton = createButton("Stop and review", actions.onStop)
  stopButton.innerHTML = '<span class="stop-square"></span>'

  const pauseButton = createButton("Pause", () =>
    latest?.isPaused ? actions.onResume() : actions.onPause()
  )

  const timer = document.createElement("span")
  timer.className = "timer"
  timer.innerHTML = '<span class="dot"></span><span class="time"></span>'
  const time = timer.querySelector(".time") as HTMLElement

  const micButton = createButton("Mute microphone", actions.onToggleMic)
  const micIcon = document.createElement("span")
  micIcon.style.display = "inline-flex"
  const meter = document.createElement("span")
  meter.className = "meter"
  meter.setAttribute("aria-hidden", "true")
  const meterBars = METER_SHAPE.map(() => {
    const meterBar = document.createElement("span")
    meter.append(meterBar)
    return meterBar
  })
  micButton.append(micIcon, meter)

  const drawButton = createButton("Draw on the page", actions.onToggleDraw)
  drawButton.innerHTML = ICONS.draw
  const blurButton = createButton("Blur part of the page", actions.onToggleBlur)
  blurButton.innerHTML = ICONS.blur

  const toast = createMutedToast({
    onUnmute: actions.onToggleMic,
    onDismiss: actions.onDismissMutedWarning,
  })
  const palette = createDrawPalette({
    onToolChange: actions.onDrawToolChange,
    onColorChange: actions.onDrawColorChange,
    onUndo: actions.onDrawUndo,
    onClear: actions.onDrawClear,
  })
  // Stacked above the bar so they move with it when it is dragged.
  const above = document.createElement("div")
  above.className = "above"
  above.append(toast, palette.element)

  bar.append(
    above,
    stopButton,
    pauseButton,
    timer,
    micButton,
    createDivider(),
    drawButton,
    blurButton
  )
  makeDraggable(bar)

  const setMeterHeights = (level: number) => {
    meterBars.forEach((meterBar, index) => {
      const height =
        METER_MIN_PX +
        level * METER_SHAPE[index] * (METER_MAX_PX - METER_MIN_PX)
      meterBar.style.height = `${height}px`
    })
  }

  const update = (state: BarState) => {
    const previous = latest
    latest = state

    time.textContent = formatRecordedTime(state.recordedMs)
    bar.classList.toggle("paused", state.isPaused)

    if (previous?.isPaused !== state.isPaused) {
      pauseButton.innerHTML = state.isPaused ? ICONS.resume : ICONS.pause
      setLabel(pauseButton, state.isPaused ? "Resume" : "Pause")
    }

    if (previous?.micState !== state.micState) {
      micIcon.innerHTML = state.micState === "on" ? ICONS.mic : ICONS.micOff
      micButton.disabled = state.micState === "unavailable"
      setLabel(micButton, getMicLabel(state.micState))
      meter.classList.toggle("muted", state.micState === "off")
      meter.classList.toggle("unavailable", state.micState === "unavailable")
      if (state.micState !== "on") setMeterHeights(0)
    }

    drawButton.setAttribute("aria-pressed", String(state.mode === "draw"))
    blurButton.setAttribute("aria-pressed", String(state.mode === "blur"))
    palette.update({
      visible: state.mode === "draw",
      tool: state.drawTool,
      color: state.drawColor,
    })
  }

  // A muted microphone records nothing, so its meter stays flat.
  const setMicLevel = (level: number) => {
    if (latest?.micState !== "on") return
    setMeterHeights(Math.min(1, Math.max(0, level)))
  }

  return {
    element: bar,
    update,
    setMicLevel,
    showMutedWarning: () => {
      toast.hidden = false
    },
    hideMutedWarning: () => {
      toast.hidden = true
    },
  }
}
