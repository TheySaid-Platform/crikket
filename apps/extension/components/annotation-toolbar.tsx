import { cn } from "@crikket/ui/lib/utils"
import {
  Crop,
  EyeOff,
  Highlighter,
  type LucideIcon,
  MoveUpRight,
  Pencil,
  Redo2,
  Slash,
  Square,
  Type,
  Undo2,
} from "lucide-react"
import { type ReactNode, useEffect } from "react"
import { ANNOTATION_COLORS, type AnnotationTool } from "@/lib/annotations"

const TOOL_DETAILS: Record<
  AnnotationTool,
  { label: string; icon: LucideIcon; key: string }
> = {
  pen: { label: "Pen", icon: Pencil, key: "P" },
  line: { label: "Line", icon: Slash, key: "L" },
  arrow: { label: "Arrow", icon: MoveUpRight, key: "A" },
  rect: { label: "Box", icon: Square, key: "R" },
  marker: { label: "Marker", icon: Highlighter, key: "M" },
  text: { label: "Text", icon: Type, key: "T" },
  blur: { label: "Blur", icon: EyeOff, key: "B" },
  crop: { label: "Crop", icon: Crop, key: "C" },
}

const DARK_SWATCH = "#111827"

export function getToolLabel(tool: AnnotationTool): string {
  return TOOL_DETAILS[tool].label
}

export function getToolIcon(tool: AnnotationTool): LucideIcon {
  return TOOL_DETAILS[tool].icon
}

interface AnnotationToolbarProps {
  tools: AnnotationTool[]
  tool: AnnotationTool
  color: string
  canUndo: boolean
  canRedo: boolean
  onToolChange: (tool: AnnotationTool) => void
  onColorChange: (color: string) => void
  onUndo: () => void
  onRedo: () => void
  // Extra actions at the end, such as "Remove crop".
  children?: ReactNode
}

/** Drawing tools, colors, undo and redo; each tool has a letter shortcut. */
export function AnnotationToolbar({
  tools,
  tool,
  color,
  canUndo,
  canRedo,
  onToolChange,
  onColorChange,
  onUndo,
  onRedo,
  children,
}: AnnotationToolbarProps) {
  useAnnotationShortcuts({ tools, onToolChange, onUndo, onRedo })

  return (
    <div
      className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-0.5 rounded-full bg-gray-900 px-2 py-1.5 text-white shadow-lg"
      role="toolbar"
    >
      {tools.map((id) => {
        const { label, icon, key } = TOOL_DETAILS[id]
        return (
          <ToolbarButton
            icon={icon}
            isActive={tool === id}
            key={id}
            label={label}
            onClick={() => onToolChange(id)}
            shortcut={key}
          />
        )
      })}

      <ToolbarDivider />

      <div className="flex items-center gap-2 px-1.5">
        {ANNOTATION_COLORS.map((swatch) => (
          <button
            aria-label={`Color ${swatch}`}
            aria-pressed={color === swatch}
            className={cn(
              "h-4 w-4 rounded-full ring-1 transition-transform hover:scale-110",
              // Black needs a light edge to show on the dark bar.
              swatch === DARK_SWATCH ? "ring-white/70" : "ring-white/25",
              color === swatch &&
                "ring-2 ring-white ring-offset-2 ring-offset-gray-900"
            )}
            key={swatch}
            onClick={() => onColorChange(swatch)}
            style={{ backgroundColor: swatch }}
            type="button"
          />
        ))}
      </div>

      <ToolbarDivider />

      <ToolbarButton
        disabled={!canUndo}
        icon={Undo2}
        label="Undo"
        onClick={onUndo}
        shortcut="Ctrl Z"
      />
      <ToolbarButton
        disabled={!canRedo}
        icon={Redo2}
        label="Redo"
        onClick={onRedo}
        shortcut="Ctrl Shift Z"
      />
      {children}
    </div>
  )
}

function ToolbarButton({
  icon: Icon,
  label,
  shortcut,
  isActive = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon
  label: string
  shortcut: string
  isActive?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={isActive}
      className={cn(
        "group relative flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition-colors",
        "hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-400",
        "disabled:pointer-events-none disabled:opacity-35",
        isActive &&
          "bg-white text-gray-900 shadow-sm hover:bg-white hover:text-gray-900"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-[17px] w-[17px]" />
      <span className="pointer-events-none absolute top-full left-1/2 z-30 mt-2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 font-medium text-[11px] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {label}
        <span className="text-white/50">{shortcut}</span>
      </span>
    </button>
  )
}

function ToolbarDivider() {
  return <span className="mx-1.5 h-5 w-px bg-white/15" />
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  )
}

type ShortcutAction =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "tool"; tool: AnnotationTool }

function getShortcutAction(
  event: KeyboardEvent,
  tools: AnnotationTool[]
): ShortcutAction | null {
  if (isTypingTarget(event.target) || event.altKey) return null
  const key = event.key.toUpperCase()

  if (event.ctrlKey || event.metaKey) {
    if (key === "Y" || (key === "Z" && event.shiftKey)) return { type: "redo" }
    return key === "Z" ? { type: "undo" } : null
  }

  const tool = tools.find((id) => TOOL_DETAILS[id].key === key)
  return tool ? { type: "tool", tool } : null
}

/** Letter keys pick a tool; Ctrl+Z undoes and Ctrl+Shift+Z (or Ctrl+Y) redoes. */
function useAnnotationShortcuts({
  tools,
  onToolChange,
  onUndo,
  onRedo,
}: {
  tools: AnnotationTool[]
  onToolChange: (tool: AnnotationTool) => void
  onUndo: () => void
  onRedo: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = getShortcutAction(event, tools)
      if (!action) return
      event.preventDefault()
      if (action.type === "undo") onUndo()
      else if (action.type === "redo") onRedo()
      else onToolChange(action.tool)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [tools, onToolChange, onUndo, onRedo])
}
