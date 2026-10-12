import { useEffect, useRef } from "react"
import type { PendingText } from "@/hooks/use-annotation-drawing"

interface AnnotationTextInputProps {
  pending: PendingText
  color: string
  // Matches the size the text will have once drawn.
  fontSize: number
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}

export function AnnotationTextInput({
  pending,
  color,
  fontSize,
  onChange,
  onCommit,
  onCancel,
}: AnnotationTextInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  // The drawing surface keeps the click from moving focus (see
  // useAnnotationDrawing), so the box can take focus as soon as it opens.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <input
      className="absolute z-10 min-w-[160px] rounded-md border border-white/70 bg-black/50 px-1.5 py-0.5 font-semibold shadow-lg outline-none backdrop-blur-sm placeholder:text-white/60"
      onBlur={onCommit}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit()
        if (event.key === "Escape") {
          event.stopPropagation()
          onCancel()
        }
      }}
      // Clicks in the box belong to the box, not the drawing surface under it.
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      placeholder="Type, then Enter"
      ref={inputRef}
      style={{
        left: pending.left,
        top: pending.top,
        color,
        fontSize: Math.max(12, fontSize),
      }}
      value={pending.value}
    />
  )
}
