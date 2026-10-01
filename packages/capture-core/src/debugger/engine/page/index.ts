import { installActionAndNavigationCapture } from "./actions"
import { installConsoleCapture } from "./console"
import { INSTALL_FLAG, PAGE_CONTROL_SOURCE } from "./constants"
import { createPageDiagnostics } from "./diagnostics"
import { createEventQueue } from "./event-queue"
import { createNetworkBodyCapture } from "./network-bodies"
import { createStringifyValue } from "./serializer"
import type { ConsoleLevel } from "./types"
import { createNonFatalReporter, truncate } from "./utils"

export function installDebuggerPageRuntime(): void {
  const scope = window as Window & {
    [INSTALL_FLAG]?: boolean
  }

  if (scope[INSTALL_FLAG]) {
    return
  }

  scope[INSTALL_FLAG] = true

  const diagnostics = createPageDiagnostics(window)
  const reporter = diagnostics.createReporter(createNonFatalReporter())
  const { enqueueEvent, flushEventQueue } = createEventQueue({
    recordQueuedEvent: diagnostics.recordQueuedEvent,
    recordFlushedBatch: diagnostics.recordFlushedBatch,
  })
  const stringifyValue = createStringifyValue(reporter)
  const isTopFrame = window === window.top

  const postAction = (
    actionType: string,
    target: string | undefined,
    metadata?: Record<string, unknown>
  ) => {
    diagnostics.recordActionEvent()
    enqueueEvent({
      kind: "action",
      timestamp: Date.now(),
      actionType,
      target,
      metadata,
    })
  }

  const postConsole = (level: ConsoleLevel, args: unknown[]) => {
    diagnostics.recordConsoleEvent()
    const serializedArgs: string[] = []
    for (const arg of args) {
      serializedArgs.push(stringifyValue(arg))
    }

    enqueueEvent({
      kind: "console",
      timestamp: Date.now(),
      level,
      message: truncate(serializedArgs.join(" ")),
      metadata: {
        argumentCount: args.length,
        // Logs from iframes (embeds, widgets) say where they came from.
        ...(isTopFrame ? {} : { frameOrigin: location.origin }),
      },
    })
  }

  // Iframes only report console output and errors; clicks and navigation come
  // from the top page.
  if (isTopFrame) {
    installActionAndNavigationCapture({
      postAction,
    })
  }

  installConsoleCapture({
    reporter,
    postConsole,
  })

  // Off until the extension says this tab is recording.
  const networkBodies = createNetworkBodyCapture({
    reporter,
    postBody: enqueueEvent,
  })
  window.addEventListener("message", (event) => {
    const data = event.data as {
      source?: unknown
      networkBodies?: unknown
    } | null
    if (event.source !== window || data?.source !== PAGE_CONTROL_SOURCE) {
      return
    }

    if (data.networkBodies === true) {
      networkBodies.enable()
    } else if (data.networkBodies === false) {
      networkBodies.disable()
    }
  })

  const flushOnPageHide = () => {
    flushEventQueue()
  }

  window.addEventListener("pagehide", flushOnPageHide, {
    capture: true,
  })

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") {
        flushEventQueue()
      }
    },
    {
      capture: true,
      passive: true,
    }
  )
}
