import type { ConsoleLevel, Reporter } from "./types"

interface ConsoleCaptureInput {
  reporter: Reporter
  postConsole: (level: ConsoleLevel, args: unknown[]) => void
}

// Past this, a page logging in a loop would freeze the tab and push real
// errors out of the report. Errors are never dropped.
const MAX_CONSOLE_EVENTS_PER_SECOND = 50

export function installConsoleCapture(input: ConsoleCaptureInput): void {
  const { reporter, postConsole } = input

  // Set while we post, so anything logged by our own code (or by a getter we
  // read while serializing) is not captured again.
  let isPosting = false
  const post = (level: ConsoleLevel, args: unknown[]) => {
    if (isPosting) {
      return
    }

    isPosting = true
    try {
      postConsole(level, args)
    } catch (error) {
      reporter.reportNonFatalError(
        "Failed to post console event in debugger instrumentation",
        error
      )
    } finally {
      isPosting = false
    }
  }

  const isWithinBudget = createRateLimiter((skippedCount) => {
    post("warn", [
      `[Crikket] Skipped ${skippedCount} console messages logged within one second`,
    ])
  })

  const safePost = (level: ConsoleLevel, args: unknown[]) => {
    if (isWithinBudget(level)) {
      post(level, args)
    }
  }

  const consoleLevels: ConsoleLevel[] = [
    "log",
    "info",
    "warn",
    "error",
    "debug",
  ]

  for (const level of consoleLevels) {
    const original = console[level].bind(console)

    console[level] = (...args: unknown[]) => {
      safePost(level, args)
      original(...args)
    }
  }

  // Other console methods that print to DevTools, mapped onto the levels the
  // report stores.
  const wrap = <TArgs extends unknown[]>(
    method: "assert" | "dir" | "table" | "trace",
    toEvent: (...args: TArgs) => [ConsoleLevel, unknown[]] | null
  ) => {
    const original = (console[method] as (...args: TArgs) => void).bind(console)

    ;(console[method] as (...args: TArgs) => void) = (...args: TArgs) => {
      const event = toEvent(...args)
      if (event) {
        safePost(event[0], event[1])
      }
      original(...args)
    }
  }

  wrap("assert", (condition?: unknown, ...args: unknown[]) =>
    condition ? null : ["error", ["Assertion failed:", ...args]]
  )
  wrap("dir", (...args: unknown[]) => ["log", args])
  wrap("table", (...args: unknown[]) => ["log", args])
  wrap("trace", (...args: unknown[]) => [
    "debug",
    ["console.trace", ...args, getCallerStack()],
  ])

  installUncaughtErrorCapture((message) => post("error", [message]))
}

// Errors the page never caught and blocked resources. DevTools shows these in
// red, but they are not console calls, so they need their own listeners.
function installUncaughtErrorCapture(postError: (message: string) => void) {
  // A throw inside an error listener fires another error event, so never let
  // one escape.
  const listen = <TEvent extends Event>(
    target: Window | Document,
    type: string,
    toMessage: (event: TEvent) => string | null
  ) => {
    target.addEventListener(
      type,
      (event) => {
        try {
          const message = toMessage(event as TEvent)
          if (message) {
            postError(message)
          }
        } catch {
          // Ignore: reporting must not break the page.
        }
      },
      true
    )
  }

  // Failed image or script loads also reach this listener, as plain Events;
  // they are already in the network log, so only script errors are kept.
  listen<ErrorEvent>(window, "error", (event) => {
    if (!(event instanceof ErrorEvent)) {
      return null
    }

    const location = event.filename
      ? ` (${event.filename}:${event.lineno}:${event.colno})`
      : ""
    return `Uncaught ${describeError(event.error) ?? event.message}${location}`
  })

  listen<PromiseRejectionEvent>(
    window,
    "unhandledrejection",
    (event) =>
      `Uncaught (in promise) ${describeError(event.reason) ?? String(event.reason)}`
  )

  listen<SecurityPolicyViolationEvent>(
    document,
    "securitypolicyviolation",
    (event) =>
      `Content Security Policy blocked ${event.blockedURI || "inline code"} (${event.violatedDirective})`
  )
}

function createRateLimiter(
  onSkipped: (skippedCount: number) => void
): (level: ConsoleLevel) => boolean {
  let windowStartedAt = 0
  let usedCount = 0
  let skippedCount = 0

  return (level) => {
    if (level === "error") {
      return true
    }

    const now = Date.now()
    if (now - windowStartedAt >= 1000) {
      windowStartedAt = now
      usedCount = 0
    }

    if (usedCount < MAX_CONSOLE_EVENTS_PER_SECOND) {
      usedCount += 1
      return true
    }

    if (skippedCount === 0) {
      setTimeout(
        () => {
          onSkipped(skippedCount)
          skippedCount = 0
        },
        1000 - (now - windowStartedAt)
      )
    }
    skippedCount += 1
    return false
  }
}

function describeError(value: unknown): string | null {
  if (value instanceof Error) {
    return value.stack?.includes(value.message)
      ? value.stack
      : `${value.name}: ${value.message}`
  }

  return null
}

function getCallerStack(): string {
  const stack = new Error("console.trace").stack ?? ""
  // Drop the "Error" line and the frames from this extension's own script.
  return stack
    .split("\n")
    .slice(1)
    .filter((line) => !line.includes("chrome-extension://"))
    .join("\n")
}
