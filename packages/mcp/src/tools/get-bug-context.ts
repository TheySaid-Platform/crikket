import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { isFailedNetworkRequest, jsonResult } from "../format"
import { fetchAllNetworkRequests } from "../network"
import { toLogItem, toNetworkItem, toReportSummary, toStepItem } from "../views"
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
const INCOMPLETE_DEBUGGER_STATUSES = new Set(["pending", "processing"])

type Caps = typeof INITIAL_CAPS

export function registerGetBugContextTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_bug_context",
    {
      title: "Get bug context",
      description:
        "Start here. Get everything needed to debug one bug report in a single call: its details, the user's steps, console errors and warnings, and failed network requests. Long lists keep their first and last items; use the other tools to read the rest.",
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
        const failedRequests = requests.filter(isFailedNetworkRequest)

        const build = (caps: Caps, logMessageMaxChars: number) => ({
          report: toReportSummary(report, deps.appOrigin),
          summary: {
            steps: steps.length,
            consoleLogs: events.logs.length,
            consoleErrors: problemLogs.filter((log) => log.level === "error")
              .length,
            consoleWarnings: problemLogs.filter((log) => log.level === "warn")
              .length,
            networkRequests: requests.length,
            failedNetworkRequests: failedRequests.length,
          },
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
            failedRequests.map(toNetworkItem),
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
            problemLogs: problemLogs.length,
            steps: steps.length,
          }),
        })

        return jsonResult(fitToBudget(build))
      })
  )
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

function fitToBudget<T>(
  build: (caps: Caps, logMessageMaxChars: number) => T
): T {
  const caps = { ...INITIAL_CAPS }
  let logMessageMaxChars = LOG_MESSAGE_MAX_CHARS

  for (;;) {
    const result = build(caps, logMessageMaxChars)
    if (JSON.stringify(result, null, 2).length <= BUG_CONTEXT_BUDGET_CHARS) {
      return result
    }

    const largest = (Object.keys(caps) as (keyof Caps)[])
      .filter((key) => caps[key] > MIN_CAP)
      .sort((a, b) => caps[b] - caps[a])[0]

    if (largest) {
      caps[largest] = Math.max(MIN_CAP, Math.floor(caps[largest] / 2))
    } else if (logMessageMaxChars > SHORT_LOG_MESSAGE_MAX_CHARS) {
      logMessageMaxChars = SHORT_LOG_MESSAGE_MAX_CHARS
    } else {
      return result
    }
  }
}

function buildNotes(input: {
  caps: Caps
  debuggerStatus: string
  failedRequests: number
  problemLogs: number
  steps: number
}): string[] {
  const notes: string[] = []

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
