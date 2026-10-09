import { Button } from "@crikket/ui/components/ui/button"
import { Check, Copy, ExternalLink } from "lucide-react"
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
    <div className="flex flex-col items-center justify-center gap-6 py-8">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/30 [animation-iteration-count:2]" />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-br from-emerald-400 to-teal-500 text-white shadow-emerald-500/30 shadow-lg ring-8 ring-emerald-500/10">
          <Check className="h-10 w-10" strokeWidth={3} />
        </span>
      </div>

      <div className="space-y-1 text-center">
        <h2 className="font-semibold text-2xl tracking-tight">
          Bug report created
        </h2>
        <p className="text-muted-foreground text-sm">
          Share the link with your team, or open the report to check it.
        </p>
      </div>

      {warnings.length > 0 ? (
        <div className="w-full max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-left">
          <p className="font-medium text-amber-700 text-sm">
            Submitted with warnings
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-700 text-xs">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid w-full max-w-md grid-cols-2 gap-3">
        <Button
          className={`w-full ${BRAND_BUTTON_CLASS}`}
          onClick={onOpenRecording}
          size="lg"
        >
          <ExternalLink className="h-4 w-4" />
          Open report
        </Button>
        <Button
          className="w-full"
          onClick={() => {
            onCopyLink()
            setIsCopied(true)
            setTimeout(() => setIsCopied(false), 2000)
          }}
          size="lg"
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
