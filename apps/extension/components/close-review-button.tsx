import { Button } from "@crikket/ui/components/ui/button"
import { cn } from "@crikket/ui/lib/utils"
import { X } from "lucide-react"
import { useEffect, useState } from "react"

interface CloseReviewButtonProps {
  isVisible: boolean
  // What is being reviewed, for the confirmation: "recording" or "screenshot".
  captureLabel: string
  // Before the report is sent, closing throws the capture away, so ask.
  confirmDiscard: boolean
  // Escape works like the button, except in the editors.
  closeOnEscape: boolean
  onDiscard: () => void
  onClose: () => void
}

// The confirmation is inline because the review can run in an iframe, where
// Chrome blocks window.confirm().
export function CloseReviewButton({
  isVisible,
  captureLabel,
  confirmDiscard,
  closeOnEscape,
  onDiscard,
  onClose,
}: CloseReviewButtonProps) {
  const [isConfirming, setIsConfirming] = useState(false)

  useEffect(() => {
    if (!(isVisible && closeOnEscape)) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (isConfirming) {
        setIsConfirming(false)
      } else if (confirmDiscard) {
        setIsConfirming(true)
      } else {
        onClose()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [closeOnEscape, confirmDiscard, isConfirming, isVisible, onClose])

  if (!isVisible) return null

  return (
    <div className="relative">
      <Button
        aria-label="Close"
        className="text-muted-foreground"
        onClick={() => (confirmDiscard ? setIsConfirming(true) : onClose())}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <X className="h-[18px] w-[18px]" />
      </Button>

      {isConfirming ? (
        <DiscardConfirm
          captureLabel={captureLabel}
          className="top-full right-0 mt-2"
          onDiscard={onDiscard}
          onKeep={() => setIsConfirming(false)}
        />
      ) : null}
    </div>
  )
}

/** Asks before a capture that was not submitted is thrown away. */
export function DiscardConfirm({
  captureLabel,
  className,
  onDiscard,
  onKeep,
}: {
  captureLabel: string
  // Where it opens, next to the button that asked.
  className: string
  onDiscard: () => void
  onKeep: () => void
}) {
  return (
    <div
      className={cn(
        "absolute z-20 w-72 space-y-3 rounded-lg border bg-popover p-3.5 text-left text-popover-foreground shadow-lg",
        className
      )}
      role="alertdialog"
    >
      <div className="space-y-1">
        <p className="font-medium text-sm">Discard this {captureLabel}?</p>
        <p className="text-muted-foreground text-xs">
          It has not been sent yet.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onKeep} size="sm" type="button" variant="outline">
          Keep editing
        </Button>
        <Button
          className="bg-red-600 text-white hover:bg-red-700"
          onClick={onDiscard}
          size="sm"
          type="button"
        >
          Discard
        </Button>
      </div>
    </div>
  )
}
