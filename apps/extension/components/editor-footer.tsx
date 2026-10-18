import { Button } from "@crikket/ui/components/ui/button"
import { cn } from "@crikket/ui/lib/utils"
import { Trash2 } from "lucide-react"
import { BRAND_BUTTON_CLASS } from "@/lib/brand"

interface EditorFooterProps {
  // A tip for the current tool, at the start of the row.
  hint?: string
  isBusy?: boolean
  canClear: boolean
  applyLabel: string
  busyLabel?: string
  applyDisabled?: boolean
  onClear: () => void
  onCancel: () => void
  onApply: () => void
}

export function EditorFooter({
  hint,
  isBusy = false,
  canClear,
  applyLabel,
  busyLabel = "Saving...",
  applyDisabled = false,
  onClear,
  onCancel,
  onApply,
}: EditorFooterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <p className="min-w-0 flex-1 text-muted-foreground text-xs">{hint}</p>
      <Button
        className="text-muted-foreground"
        disabled={isBusy || !canClear}
        onClick={onClear}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Trash2 className="h-4 w-4" />
        Clear all
      </Button>
      <div className="flex gap-2">
        <Button
          disabled={isBusy}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          className={cn("min-w-[110px]", BRAND_BUTTON_CLASS)}
          disabled={isBusy || applyDisabled}
          onClick={onApply}
          size="sm"
          type="button"
        >
          {isBusy ? busyLabel : applyLabel}
        </Button>
      </div>
    </div>
  )
}
