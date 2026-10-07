import { createButton, createDivider, setLabel } from "./dom"
import type { LiveDrawTool } from "./draw-layer"
import { ICONS } from "./icons"

// The Lightshot-style tools for drawing on the page while recording.
const PALETTE_TOOLS: { id: LiveDrawTool; label: string; icon: string }[] = [
  { id: "pen", label: "Pen", icon: ICONS.pen },
  { id: "line", label: "Line", icon: ICONS.line },
  { id: "arrow", label: "Arrow", icon: ICONS.arrow },
  { id: "rect", label: "Box", icon: ICONS.box },
  { id: "marker", label: "Marker", icon: ICONS.marker },
]

const PALETTE_COLORS = [
  { value: "#ef4444", name: "Red" },
  { value: "#facc15", name: "Yellow" },
  { value: "#22c55e", name: "Green" },
  { value: "#3b82f6", name: "Blue" },
  { value: "#ffffff", name: "White" },
]

export const DRAW_PALETTE_STYLES = `
.palette {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px;
  border-radius: 16px;
  background: rgba(17, 17, 21, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.32);
  white-space: nowrap;
  animation: pop-in 0.2s ease;
}
.palette[hidden] { display: none; }
.palette .button { min-width: 32px; height: 32px; padding: 0 6px; border-radius: 10px; }
.palette .button svg { width: 18px; height: 18px; }
.swatch {
  all: unset;
  position: relative;
  width: 18px;
  height: 18px;
  margin: 0 3px;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
  transition: transform 0.12s ease;
}
.swatch:hover { transform: scale(1.15); }
.swatch[aria-pressed="true"] {
  box-shadow: 0 0 0 2px rgba(17, 17, 21, 0.95), 0 0 0 4px #fff;
}
`

export interface DrawPaletteActions {
  onToolChange: (tool: LiveDrawTool) => void
  onColorChange: (color: string) => void
  onUndo: () => void
  onClear: () => void
}

export interface DrawPalette {
  element: HTMLElement
  update: (state: {
    visible: boolean
    tool: LiveDrawTool
    color: string
  }) => void
}

export function createDrawPalette(actions: DrawPaletteActions): DrawPalette {
  const palette = document.createElement("div")
  palette.className = "palette"
  palette.setAttribute("role", "toolbar")
  palette.setAttribute("aria-label", "Drawing tools")
  palette.hidden = true

  const toolButtons = PALETTE_TOOLS.map(({ id, label, icon }) => {
    const button = createButton(label, () => actions.onToolChange(id))
    button.innerHTML = icon
    return { id, button }
  })

  const swatches = PALETTE_COLORS.map(({ value, name }) => {
    const swatch = document.createElement("button")
    swatch.type = "button"
    swatch.className = "swatch"
    swatch.style.background = value
    setLabel(swatch, name)
    swatch.addEventListener("click", (event) => {
      event.stopPropagation()
      actions.onColorChange(value)
    })
    return { color: value, swatch }
  })

  const undoButton = createButton("Undo last drawing", actions.onUndo)
  undoButton.innerHTML = ICONS.undo
  const clearButton = createButton("Clear drawings", actions.onClear)
  clearButton.innerHTML = ICONS.trash

  palette.append(
    ...toolButtons.map(({ button }) => button),
    createDivider(),
    ...swatches.map(({ swatch }) => swatch),
    createDivider(),
    undoButton,
    clearButton
  )

  return {
    element: palette,
    update: ({ visible, tool, color }) => {
      palette.hidden = !visible
      for (const { id, button } of toolButtons) {
        button.setAttribute("aria-pressed", String(id === tool))
      }
      for (const { color: swatchColor, swatch } of swatches) {
        swatch.setAttribute("aria-pressed", String(swatchColor === color))
      }
    },
  }
}
