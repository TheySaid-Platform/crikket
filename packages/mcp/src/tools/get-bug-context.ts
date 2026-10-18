import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { isFailedNetworkRequest, jsonResult } from "../format"
import { describeMissingRequests, fetchAllNetworkRequests } from "../network"
import type { DebuggerEvents } from "../reader"
import { toLogItem, toNetworkItem, toReportSummary, toStepItem } from "../views"
import { withBodies } from "./get-network-requests"
import {
  READ_ONLY_ANNOTATIONS,
  reportInputSchema,
  resolveReportId,
  runTool,
  type ToolDependencies,
} from "./shared"

/** Target size of the whole result, well under the hard cap in format.ts. */
export const BUG_CONTEXT_BUDGET_CHARS = 40_000
const INITIAL_CAPS = { steps: 60, logs: 40, requests: 30 }
const MIN_CAP = 6
const LOG_MESSAGE_MAX_CHARS = 600
const SHORT_LOG_MESSAGE_MAX_CHARS = 200
/** Capture keeps 2,000 characters of a message, stack included. */
const FIRST_ERROR_MAX_CHARS = 4000
/** Failed requests whose bodies are shown inline. */
const INLINE_BODY_REQUESTS = 5
const BODY_MAX_CHARS_STEPS = [1000, 300, 0]
const INCOMPLETE_DEBUGGER_STATUSES = new Set(["pending", "processing"])

type Caps = typeof INITIAL_CAPS
type DebuggerLog = DebuggerEvents["logs"][number]

interface Budget {
  caps: Caps
  logMessageMaxChars: number
  bodyMaxChars: number
}

export function registerGetBugContextTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_bug_context",
    {
      title: "Get bug context",
      description:
        "Start here. Get everything needed to debug one bug report in a single call: its details, the user's steps, the first error of each tab in full (with its stack), console errors and warnings, failed network requests (the first few with bodies), and moments worth seeing with get_video_frames. Times are offsetMs, ms from the start of the video. Long lists keep their first and last items; use the other tools to read the rest.",
      inputSchema: { report: reportInputSchema },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) =>
      runTool("get_bug_context", async () => {
        const id = resolveReportId(input.report)
        // The report read runs first: it enforces access, and its NOT_FOUND
        // is the error the caller should see.
        const report = await deps.reader.getReport(id)
        const [events, requests] = await Promise.all([
          deps.reader.getDebuggerEvents(id),
          fetchAllNetworkRequests(deps.reader, { id }),
        ])

        const steps = events.actions.map(toStepItem)
        const problemLogs = events.logs.filter(
          (log) => log.level === "error" || log.level === "warn"
        )
        const failedRequests = requests.items.filter(isFailedNetworkRequest)
        const failedWithBodies = await withBodies(deps.reader, {
          id,
          mode: "errors",
          page: failedRequests.slice(0, INLINE_BODY_REQUESTS),
          maxChars: BODY_MAX_CHARS_STEPS[0],
        })
        const notStored = countNotStored(report.metadata, {
          actions: events.actions.length,
          logs: events.logs.length,
          networkRequests: requests.expectedTotal,
        })

        const build = ({ caps, logMessageMaxChars, bodyMaxChars }: Budget) => ({
          report: toReportSummary(report, deps.appOrigin),
          summary: {
            steps: steps.length,
            consoleLogs: events.logs.length,
            consoleErrors: problemLogs.filter((log) => log.level === "error")
              .length,
            consoleWarnings: problemLogs.filter((log) => log.level === "warn")
              .length,
            networkRequests: requests.items.length,
            failedNetworkRequests: failedRequests.length,
            ...(notStored ? { capturedButNotStored: notStored } : {}),
          },
          firstErrorPerTab: firstErrorPerTab(events.logs).map((log) =>
            toLogItem(log, { messageMaxChars: FIRST_ERROR_MAX_CHARS })
          ),
          steps: keepEnds(steps, caps.steps),
          consoleErrorsAndWarnings: keepEnds(
            problemLogs.map((log) =>
              toLogItem(log, {
                includeMetadata: false,
                messageMaxChars: logMessageMaxChars,
              })
            ),
            caps.logs
          ),
          failedNetworkRequests: keepEnds(
            [
              ...failedWithBodies.map((request) =>
                trimBodies(request, bodyMaxChars)
              ),
              ...failedRequests.slice(INLINE_BODY_REQUESTS).map(toNetworkItem),
            ],
            caps.requests
          ),
          screen: describeScreenAccess({
            attachmentType: report.attachmentType,
            stepOffsets: events.actions.map((action) => action.offset),
            firstProblemOffsets: [
              problemLogs.find((log) => log.level === "error")?.offset,
              failedRequests[0]?.offset,
            ],
          }),
          notes: buildNotes({
            caps,
            debuggerStatus: report.debuggerIngestionStatus,
            failedRequests: failedRequests.length,
            missingRequests: describeMissingRequests(requests),
            notStored,
            problemLogs: problemLogs.length,
            steps: steps.length,
          }),
        })

        return jsonResult(fitToBudget(build))
      })
  )
}

/** The first error of the whole report and of each tab, in time order. */
export function firstErrorPerTab(logs: DebuggerLog[]): DebuggerLog[] {
  const seenTabs = new Set<string>()
  const firsts: DebuggerLog[] = []
  for (const log of logs) {
    const tab = String(log.tabId ?? "none")
    if (log.level === "error" && !seenTabs.has(tab)) {
      seenTabs.add(tab)
      firsts.push(log)
    }
  }
  return firsts
}

function trimBodies<
  T extends { requestBody?: string | null; responseBody?: string | null },
>(request: T, maxChars: number) {
  const { requestBody, responseBody, ...rest } = request
  if (
    maxChars <= 0 ||
    (requestBody === undefined && responseBody === undefined)
  ) {
    return rest
  }
  return {
    ...rest,
    requestBody: shorten(requestBody, maxChars),
    responseBody: shorten(responseBody, maxChars),
  }
}

function shorten(value: string | null | undefined, maxChars: number) {
  if (typeof value !== "string" || value.length <= maxChars) {
    return value ?? null
  }
  return `${value.slice(0, maxChars)}… [${value.length - maxChars} more characters]`
}

type ItemCounts = { actions: number; logs: number; networkRequests: number }

/**
 * Compares what the recorder says it captured (stored on the report at
 * upload) with what was stored. Ingestion drops items over 2,000 per kind and
 * items that fail validation, so missing items here mean the lists are
 * partial.
 */
export function countNotStored(
  metadata: unknown,
  stored: ItemCounts
): Partial<ItemCounts> | null {
  const captured =
    typeof metadata === "object" && metadata !== null
      ? (metadata as { debuggerSummary?: Partial<ItemCounts> }).debuggerSummary
      : undefined
  if (!captured) {
    return null
  }

  const missing: Partial<ItemCounts> = {}
  for (const kind of ["actions", "logs", "networkRequests"] as const) {
    const capturedCount = captured[kind]
    if (typeof capturedCount === "number" && capturedCount > stored[kind]) {
      missing[kind] = capturedCount - stored[kind]
    }
  }
  return Object.keys(missing).length > 0 ? missing : null
}

const MAX_SUGGESTED_MOMENTS = 4

/**
 * Points the AI at get_video_frames, with the steps most worth seeing: the
 * one just before the first console error, the one just before the first
 * failed request, and the last step.
 */
export function describeScreenAccess(input: {
  attachmentType: string | null
  stepOffsets: (number | null)[]
  firstProblemOffsets: (number | null | undefined)[]
}) {
  if (input.attachmentType === "screenshot") {
    return {
      tool: "get_video_frames",
      note: "This report is a screenshot; get_video_frames returns it.",
    }
  }

  if (input.attachmentType === "replay") {
    return {
      note: "This report is an instant replay of the page, not a video, so get_video_frames has nothing to show.",
    }
  }

  if (input.attachmentType !== "video") {
    return null
  }

  const stepBefore = (offset: number): number | null => {
    let found: number | null = null
    for (const [index, stepOffset] of input.stepOffsets.entries()) {
      if (stepOffset !== null && stepOffset <= offset) {
        found = index + 1
      }
    }
    return found
  }

  const steps = new Set<number>()
  for (const offset of input.firstProblemOffsets) {
    const step = typeof offset === "number" ? stepBefore(offset) : null
    if (step !== null) {
      steps.add(step)
    }
  }
  const lastStep = input.stepOffsets.findLastIndex((offset) => offset !== null)
  if (lastStep !== -1) {
    steps.add(lastStep + 1)
  }

  return {
    tool: "get_video_frames",
    suggestedMoments: [...steps]
      .sort((a, b) => a - b)
      .slice(0, MAX_SUGGESTED_MOMENTS)
      .map((step) => `step:${step}`),
    note: "Frames show the screen just after each step. The video's audio is not available.",
  }
}

/**
 * Keeps the first and last items of a long list. The start shows where the
 * user began; the end is usually where the bug showed up.
 */
export function keepEnds<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) {
    return items
  }

  const head = Math.ceil(cap / 3)
  const tail = cap - head
  return [...items.slice(0, head), ...items.slice(items.length - tail)]
}

function fitToBudget<T>(build: (budget: Budget) => T): T {
  const budget: Budget = {
    caps: { ...INITIAL_CAPS },
    logMessageMaxChars: LOG_MESSAGE_MAX_CHARS,
    bodyMaxChars: BODY_MAX_CHARS_STEPS[0] ?? 0,
  }

  for (;;) {
    const result = build(budget)
    if (JSON.stringify(result, null, 2).length <= BUG_CONTEXT_BUDGET_CHARS) {
      return result
    }

    const { caps } = budget
    const largest = (Object.keys(caps) as (keyof Caps)[])
      .filter((key) => caps[key] > MIN_CAP)
      .sort((a, b) => caps[b] - caps[a])[0]
    const nextBodyMax = BODY_MAX_CHARS_STEPS.find(
      (step) => step < budget.bodyMaxChars
    )

    if (largest) {
      caps[largest] = Math.max(MIN_CAP, Math.floor(caps[largest] / 2))
    } else if (budget.logMessageMaxChars > SHORT_LOG_MESSAGE_MAX_CHARS) {
      budget.logMessageMaxChars = SHORT_LOG_MESSAGE_MAX_CHARS
    } else if (nextBodyMax !== undefined) {
      budget.bodyMaxChars = nextBodyMax
    } else {
      return result
    }
  }
}

function buildNotes(input: {
  caps: Caps
  debuggerStatus: string
  failedRequests: number
  missingRequests: string | null
  notStored: Partial<ItemCounts> | null
  problemLogs: number
  steps: number
}): string[] {
  const notes: string[] = []

  if (input.notStored) {
    const parts = [
      input.notStored.logs ? `${input.notStored.logs} console logs` : null,
      input.notStored.networkRequests
        ? `${input.notStored.networkRequests} network requests`
        : null,
      input.notStored.actions ? `${input.notStored.actions} steps` : null,
    ].filter(Boolean)
    notes.push(
      `The recorder captured ${parts.join(", ")} that were not stored (over the 2,000 per kind limit or invalid). These lists are partial: a missing error is not proof there was none.`
    )
  }

  if (input.missingRequests) {
    notes.push(input.missingRequests)
  }

  if (INCOMPLETE_DEBUGGER_STATUSES.has(input.debuggerStatus)) {
    notes.push(
      "Steps, logs and network requests are still being processed, so they may be incomplete. Try again in a minute."
    )
  }

  if (input.steps > input.caps.steps) {
    notes.push(
      `Showing ${input.caps.steps} of ${input.steps} steps (first and last). Use get_reproduction_steps for all of them.`
    )
  }

  if (input.problemLogs > input.caps.logs) {
    notes.push(
      `Showing ${input.caps.logs} of ${input.problemLogs} console errors and warnings (first and last). Use get_console_logs for all of them.`
    )
  }

  if (input.failedRequests > input.caps.requests) {
    notes.push(
      `Showing ${input.caps.requests} of ${input.failedRequests} failed requests (first and last). Use get_network_requests with failedOnly for all of them.`
    )
  }

  return notes
}
