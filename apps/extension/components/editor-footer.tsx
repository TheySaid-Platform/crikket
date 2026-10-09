import { Button } from "@crikket/ui/components/ui/button"
import { cn } from "@crikket/ui/lib/utils"
import { Trash2 } from "lucide-react"
import { BRAND_BUTTON_CLASS } from "@/lib/brand"

interface EditorFooterProps {
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
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      <Button
        className="text-muted-foreground"
        disabled={isBusy || !canClear}
        onClick={onClear}
        type="button"
        variant="ghost"
      >
        <Trash2 className="h-4 w-4" />
        Clear all
      </Button>
      <div className="ml-auto flex gap-2">
        <Button
          disabled={isBusy}
          onClick={onCancel}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button
          className={cn("min-w-[140px]", BRAND_BUTTON_CLASS)}
          disabled={isBusy || applyDisabled}
          onClick={onApply}
          type="button"
        >
          {isBusy ? busyLabel : applyLabel}
        </Button>
      </div>
    </div>
  )
}
