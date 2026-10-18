import { Button } from "@crikket/ui/components/ui/button"
import { AlertTriangle, Check, Copy, ExternalLink } from "lucide-react"
import { useState } from "react"
import { BRAND_BUTTON_CLASS } from "@/lib/brand"

interface SuccessStepProps {
  onOpenRecording: () => void
  onCopyLink: () => void
  onClose: () => void
  warnings?: string[]
}

export function SuccessStep({
  onOpenRecording,
  onCopyLink,
  onClose,
  warnings = [],
}: SuccessStepProps) {
  const [isCopied, setIsCopied] = useState(false)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600">
        <Check className="h-[22px] w-[22px]" strokeWidth={2.5} />
      </span>

      <div className="space-y-1 text-center">
        <h2 className="font-semibold text-lg tracking-tight">
          Bug report created
        </h2>
        <p className="text-muted-foreground text-sm">
          Share the link with your team, or open the report to check it.
        </p>
      </div>

      {warnings.length > 0 ? (
        <div className="flex w-full max-w-md gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-amber-800 text-xs leading-relaxed">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Sent with a warning</p>
            {warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-1 grid w-full max-w-sm grid-cols-2 gap-2">
        <Button
          className={`h-10 w-full ${BRAND_BUTTON_CLASS}`}
          onClick={onOpenRecording}
        >
          <ExternalLink className="h-4 w-4" />
          Open report
        </Button>
        <Button
          className="h-10 w-full"
          onClick={() => {
            onCopyLink()
            setIsCopied(true)
            setTimeout(() => setIsCopied(false), 2000)
          }}
          variant="outline"
        >
          {isCopied ? (
            <>
              <Check className="h-4 w-4" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy link
            </>
          )}
        </Button>
        <Button
          className="col-span-2 w-full text-muted-foreground"
          onClick={onClose}
          variant="ghost"
        >
          Close
        </Button>
      </div>
    </div>
  )
}
