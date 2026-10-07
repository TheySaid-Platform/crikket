import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import { cn } from "@crikket/ui/lib/utils"
import type { ReactNode } from "react"

interface ReviewShellProps {
  // The close (X) button, shown when the review opens over a page.
  closeButton: ReactNode
  // Uses the width of the window, so a long screenshot can show at the size
  // it had on the page.
  wide?: boolean
  children: ReactNode
}

/** The frame around the recorder and the review: backdrop, card and header. */
export function ReviewShell({
  closeButton,
  wide = false,
  children,
}: ReviewShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(60rem_30rem_at_0%_0%,rgba(37,99,235,0.14),transparent_70%),radial-gradient(50rem_30rem_at_100%_0%,rgba(124,58,237,0.12),transparent_70%)] bg-slate-100 p-4 sm:p-6">
      <Card
        className={cn(
          "relative w-full gap-0 overflow-visible rounded-3xl border-white/80 bg-white/90 py-0 shadow-2xl shadow-slate-900/10 backdrop-blur-xl",
          wide ? "max-w-[1600px]" : "max-w-5xl"
        )}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-linear-to-r from-transparent via-blue-500/50 to-transparent"
        />
        <CardHeader className="flex flex-row items-center gap-3 border-border/60 border-b px-5 py-4">
          {closeButton}
          <img
            alt=""
            className="h-9 w-9 rounded-xl shadow-sm ring-1 ring-black/5"
            height={36}
            src="/icon/128.png"
            width={36}
          />
          <CardTitle className="min-w-0 flex-1 truncate font-semibold text-base tracking-tight">
            Crikket bug report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 p-5 sm:p-6">{children}</CardContent>
      </Card>
    </div>
  )
}
