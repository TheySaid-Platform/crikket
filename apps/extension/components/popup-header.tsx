import { env } from "@crikket/env/extension"
import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { ArrowUpRight, Keyboard } from "lucide-react"

const openTab = async (url: string, errorMessage: string) => {
  try {
    await chrome.tabs.create({ url })
    window.close()
  } catch (error: unknown) {
    reportNonFatalError(errorMessage, error)
  }
}

const HEADER_BUTTON_CLASS =
  "inline-flex h-[26px] items-center gap-1 rounded-md bg-white/8 px-2 font-medium text-[11.5px] text-white/90 ring-1 ring-white/10 transition-colors hover:bg-white/15 hover:text-white"

export function PopupHeader() {
  return (
    <header className="rounded-lg bg-slate-900 py-2 pr-2 pl-2 text-white">
      <div className="flex items-center gap-2.5">
        <img
          alt=""
          className="h-8 w-8 rounded-[9px] ring-1 ring-white/15"
          height={32}
          src="/icon/128.png"
          width={32}
        />
        <h1 className="min-w-0 flex-1 font-semibold text-sm leading-tight tracking-tight">
          Crikket
          <span className="ml-2 font-mono font-normal text-[10px] text-white/50 tabular-nums">
            v{chrome.runtime.getManifest().version}
          </span>
        </h1>
        <button
          aria-label="Keyboard shortcuts"
          className={HEADER_BUTTON_CLASS}
          onClick={() =>
            openTab(
              "chrome://extensions/shortcuts",
              "Failed to open Chrome extension shortcuts settings"
            )
          }
          title="Keyboard shortcuts"
          type="button"
        >
          <Keyboard className="h-3.5 w-3.5" />
        </button>
        <button
          className={HEADER_BUTTON_CLASS}
          onClick={() =>
            openTab(env.VITE_APP_URL, "Failed to open the Crikket dashboard")
          }
          title="Open the dashboard"
          type="button"
        >
          Dashboard
          <ArrowUpRight className="h-3 w-3" />
        </button>
      </div>
    </header>
  )
}
