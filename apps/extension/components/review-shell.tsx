import { cn } from "@crikket/ui/lib/utils"
import type { ReactNode } from "react"

interface ReviewShellProps {
  // Shown in the header: "New bug report", "Crikket setup"...
  title: string
  // The close (X) button, shown when the review opens over a page.
  closeButton: ReactNode
  // Over a page the review fills its frame; in its own tab it is a card.
  isOverPage: boolean
  // Setup and recording steps are small; long screenshots show at their
  // real size, so they get more room.
  size?: "narrow" | "default" | "wide"
  children: ReactNode
}

const SIZE_CLASSES = {
  narrow: "max-w-xl",
  default: "max-w-5xl",
  wide: "max-w-[1600px]",
}

/** The frame around the recorder and the review: header and content. */
export function ReviewShell({
  title,
  closeButton,
  isOverPage,
  size = "default",
  children,
}: ReviewShellProps) {
  const header = (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b pr-4 pl-5">
      <img
        alt=""
        className="h-6 w-6 rounded-[7px]"
        height={24}
        src="/icon/128.png"
        width={24}
      />
      <h1 className="min-w-0 flex-1 truncate font-semibold text-[15px] tracking-tight">
        {title}
      </h1>
      {closeButton}
    </header>
  )

  // The page's frame already has the radius and shadow, so no card here.
  if (isOverPage) {
    return (
      <div className="flex h-screen flex-col bg-background">
        {header}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/70 p-4 sm:p-6">
      <div
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-lg border bg-background shadow-lg",
          SIZE_CLASSES[size]
        )}
      >
        {header}
        <div className="flex flex-col">{children}</div>
      </div>
    </div>
  )
}
