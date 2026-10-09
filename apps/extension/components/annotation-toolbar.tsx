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
  const isCustomColor = !ANNOTATION_COLORS.includes(color)

  return (
    <div
      className="flex flex-wrap items-center gap-1 rounded-2xl bg-zinc-900 p-1.5 text-white shadow-lg ring-1 ring-white/10"
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

      <div className="flex items-center gap-1.5 px-1.5">
        {ANNOTATION_COLORS.map((swatch) => (
          <button
            aria-label={`Color ${swatch}`}
            aria-pressed={color === swatch}
            className={cn(
              "h-[18px] w-[18px] rounded-full ring-1 ring-white/25 transition-transform hover:scale-110",
              color === swatch &&
                "ring-2 ring-white ring-offset-2 ring-offset-zinc-900"
            )}
            key={swatch}
            onClick={() => onColorChange(swatch)}
            style={{ backgroundColor: swatch }}
            type="button"
          />
        ))}
        <label
          className={cn(
            "relative h-[18px] w-[18px] cursor-pointer rounded-full bg-[conic-gradient(#ef4444,#facc15,#22c55e,#3b82f6,#a855f7,#ef4444)] ring-1 ring-white/25 transition-transform hover:scale-110",
            isCustomColor &&
              "ring-2 ring-white ring-offset-2 ring-offset-zinc-900"
          )}
          title="Pick any color"
        >
          <span className="sr-only">Pick any color</span>
          <input
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={(event) => onColorChange(event.target.value)}
            type="color"
            value={isCustomColor ? color : "#ec4899"}
          />
        </label>
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
        "group relative flex h-9 w-9 items-center justify-center rounded-xl text-white/75 transition-colors",
        "hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-400",
        "disabled:pointer-events-none disabled:opacity-35",
        isActive &&
          "bg-white text-zinc-900 shadow-sm hover:bg-white hover:text-zinc-900"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-[18px] w-[18px]" />
      <span className="pointer-events-none absolute top-full left-1/2 z-30 mt-2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-lg bg-zinc-900 px-2 py-1 font-medium text-[11px] text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity group-hover:opacity-100">
        {label}
        <span className="text-white/50">{shortcut}</span>
      </span>
    </button>
  )
}

function ToolbarDivider() {
  return <span className="mx-1 h-6 w-px bg-white/15" />
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
