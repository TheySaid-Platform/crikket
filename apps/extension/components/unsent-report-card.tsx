import { Button } from "@crikket/ui/components/ui/button"
import { FileWarning } from "lucide-react"

export function UnsentReportCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-50 p-3">
      <p className="flex items-center gap-2 text-amber-900 text-sm">
        <FileWarning className="h-4 w-4 shrink-0" />
        Your last report is not sent yet.
      </p>
      <Button onClick={onOpen} size="sm" variant="outline">
        Open it
      </Button>
    </div>
  )
}
