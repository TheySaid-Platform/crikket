import { env } from "@crikket/env/extension"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { Button } from "@crikket/ui/components/ui/button"
import { ArrowUpRight, Keyboard } from "lucide-react"

const openTab = async (url: string, errorMessage: string) => {
  try {
    await chrome.tabs.create({ url })
    window.close()
  } catch (error: unknown) {
    reportNonFatalError(errorMessage, error)
  }
}

export function PopupHeader() {
  return (
    <header className="relative overflow-hidden rounded-2xl bg-zinc-950 px-4 py-3.5 text-white shadow-lg shadow-zinc-950/20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-blue-500/40 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 left-4 h-36 w-36 rounded-full bg-violet-500/30 blur-3xl"
      />
      <div className="relative flex items-center gap-3">
        <img
          alt=""
          className="h-10 w-10 rounded-xl shadow-md ring-1 ring-white/15"
          height={40}
          src="/icon/128.png"
          width={40}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-semibold text-[15px] leading-tight tracking-tight">
              Crikket
            </h1>
            <button
              className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 font-medium text-[11px] text-white/90 ring-1 ring-white/10 transition-colors hover:bg-white/20 hover:text-white"
              onClick={() =>
                openTab(
                  env.VITE_APP_URL,
                  "Failed to open the Crikket dashboard"
                )
              }
              title="Open the dashboard"
              type="button"
            >
              Dashboard
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
          <p className="truncate text-white/60 text-xs">
            Bug reports with full context
          </p>
        </div>
      </div>
    </header>
  )
}

export function PopupFooter() {
  return (
    <footer className="flex items-center justify-between px-1">
      <Button
        className="-ml-2 text-muted-foreground"
        onClick={() =>
          openTab(
            "chrome://extensions/shortcuts",
            "Failed to open Chrome extension shortcuts settings"
          )
        }
        size="sm"
        variant="ghost"
      >
        <Keyboard className="h-4 w-4" />
        Shortcuts
      </Button>
      <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-[10px] text-muted-foreground tabular-nums">
        v{chrome.runtime.getManifest().version}
      </span>
    </footer>
  )
}
