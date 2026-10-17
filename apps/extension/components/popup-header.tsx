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
    <header className="flex h-12 items-center gap-2.5 rounded-lg bg-slate-900 pr-2 pl-2 text-white">
      <img
        alt=""
        className="h-[30px] w-[30px] rounded-[9px] ring-1 ring-white/15"
        height={30}
        src="/icon/128.png"
        width={30}
      />
      <h1 className="flex-1 font-semibold text-sm tracking-tight">Crikket</h1>
      <button
        className="inline-flex h-[26px] items-center gap-1 rounded-md bg-white/8 px-2.5 font-medium text-[11.5px] text-white/90 ring-1 ring-white/10 transition-colors hover:bg-white/15 hover:text-white"
        onClick={() =>
          openTab(env.VITE_APP_URL, "Failed to open the Crikket dashboard")
        }
        title="Open the dashboard"
        type="button"
      >
        Dashboard
        <ArrowUpRight className="h-3 w-3" />
      </button>
    </header>
  )
}

export function PopupFooter() {
  return (
    <footer className="flex items-center justify-between px-0.5">
      <Button
        className="-ml-2 h-7 px-2 font-normal text-muted-foreground text-xs"
        onClick={() =>
          openTab(
            "chrome://extensions/shortcuts",
            "Failed to open Chrome extension shortcuts settings"
          )
        }
        size="sm"
        variant="ghost"
      >
        <Keyboard className="h-3.5 w-3.5" />
        Shortcuts
      </Button>
      <span className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80 tabular-nums">
        v{chrome.runtime.getManifest().version}
      </span>
    </footer>
  )
}
