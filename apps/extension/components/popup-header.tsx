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
  "inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 font-medium text-[11px] text-white/90 ring-1 ring-white/10 transition-colors hover:bg-white/20 hover:text-white"

export function PopupHeader() {
  return (
    <header className="relative overflow-hidden rounded-2xl bg-zinc-950 px-3.5 py-2.5 text-white shadow-lg shadow-zinc-950/20">
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
          className="h-8 w-8 rounded-lg shadow-md ring-1 ring-white/15"
          height={32}
          src="/icon/128.png"
          width={32}
        />
        <h1 className="min-w-0 flex-1 font-semibold text-[15px] leading-tight tracking-tight">
          Crikket
          <span className="ml-2 font-medium text-[10px] text-white/50 tabular-nums">
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
