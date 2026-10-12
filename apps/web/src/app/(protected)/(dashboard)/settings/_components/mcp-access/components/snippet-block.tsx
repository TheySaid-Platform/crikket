"use client"

import { CopyValueButton } from "../../public-keys/components/copy-value-button"

interface SnippetBlockProps {
  copyLabel: string
  label: string
  note?: string
  value: string
}

export function SnippetBlock({
  copyLabel,
  label,
  note,
  value,
}: SnippetBlockProps) {
  return (
    <div className="space-y-1.5">
      <p className="font-medium text-xs">{label}</p>
      <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-2">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
          {value}
        </pre>
        <CopyValueButton ariaLabel={copyLabel} value={value} />
      </div>
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
    </div>
  )
}
