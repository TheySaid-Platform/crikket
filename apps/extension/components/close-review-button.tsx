import { Button } from "@crikket/ui/components/ui/button"
import { X } from "lucide-react"
import { useState } from "react"

interface CloseReviewButtonProps {
  isVisible: boolean
  // What is being reviewed, for the confirmation: "recording" or "screenshot".
  captureLabel: string
  // Before the report is sent, closing throws the capture away, so ask.
  confirmDiscard: boolean
  onDiscard: () => void
  onClose: () => void
}

// Jam-style close button for the review. The confirmation is inline because
// the review can run in an iframe, where Chrome blocks window.confirm().
export function CloseReviewButton({
  isVisible,
  captureLabel,
  confirmDiscard,
  onDiscard,
  onClose,
}: CloseReviewButtonProps) {
  const [isConfirming, setIsConfirming] = useState(false)

  if (!isVisible) return null

  return (
    <div className="relative">
      <Button
        aria-label="Close"
        onClick={() => (confirmDiscard ? setIsConfirming(true) : onClose())}
        size="icon"
        type="button"
        variant="outline"
      >
        <X className="h-4 w-4" />
      </Button>

      {isConfirming ? (
        <div
          className="absolute top-full left-0 z-20 mt-2 w-64 space-y-3 rounded-lg border bg-popover p-3 text-left text-popover-foreground shadow-lg"
          role="alertdialog"
        >
          <div className="space-y-1">
            <p className="font-medium text-sm">Discard this {captureLabel}?</p>
            <p className="text-muted-foreground text-xs">
              It has not been submitted yet.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={onDiscard}
              size="sm"
              type="button"
              variant="destructive"
            >
              Discard
            </Button>
            <Button
              onClick={() => setIsConfirming(false)}
              size="sm"
              type="button"
              variant="outline"
            >
              Keep editing
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
