import { FileWarning } from "lucide-react"

export function UnsentReportCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex h-[38px] items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 pr-1.5 pl-2.5 text-amber-800">
      <FileWarning className="h-3.5 w-3.5 shrink-0" />
      <p className="flex-1 font-medium text-xs">
        Your last report is not sent yet.
      </p>
      <button
        className="h-[26px] rounded-md border border-amber-200 bg-white px-2.5 font-semibold text-[11.5px] transition-colors hover:bg-amber-100"
        onClick={onOpen}
        type="button"
      >
        Open it
      </button>
    </div>
  )
}
