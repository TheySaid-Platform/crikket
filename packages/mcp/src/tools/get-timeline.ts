import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { clampInteger, formatOffset, pagedResult } from "../format"
import { type FrameRequest, resolveMoment } from "../media/targets"
import {
  type AllNetworkRequests,
  describeMissingRequests,
  fetchAllNetworkRequests,
} from "../network"
import type { DebuggerEvents, NetworkRequestItem } from "../reader"
import { toLogItem, toNetworkItem, toStepItem } from "../views"
import {
  READ_ONLY_ANNOTATIONS,
  reportInputSchema,
  resolveReportId,
  runTool,
  type ToolDependencies,
  ToolInputError,
} from "./shared"

const KINDS = ["step", "console", "network"] as const
type Kind = (typeof KINDS)[number]

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 300
const LOG_MESSAGE_MAX_CHARS = 500
/** Breaks ties between events at the same instant: cause before effect. */
const KIND_ORDER: Record<Kind, number> = { step: 0, console: 1, network: 2 }

const momentSchema = z.union([
  z.string().trim().min(1).max(40),
  z.number().int().min(0),
])

type TimelineItem =
  | ({ kind: "step" } & ReturnType<typeof toStepItem>)
  | ({ kind: "console" } & ReturnType<typeof toLogItem>)
  | ({ kind: "network" } & ReturnType<typeof toNetworkItem>)

interface TimelineEntry {
  timestamp: string
  offsetMs: number | null
  item: TimelineItem
}

export function registerGetTimelineTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_timeline",
    {
      title: "Get timeline",
      description:
        'Get the user\'s steps, console logs and network requests merged into one list in time order, each tagged with its `kind`, so you can see what happened right before and after a moment. Narrow it with `from` / `to` (milliseconds like offsetMs, a time like "1:05" or "45s", or a step like "step:7", meaning the moment the step happened), `kinds` and `tabId`. Step numbers and request ids match the other tools. Log messages are shortened; use get_console_logs and get_network_request_details for the full content.',
      inputSchema: {
        report: reportInputSchema,
        from: momentSchema
          .optional()
          .describe('Start of the range, inclusive, e.g. "step:3" or "0:40".'),
        to: momentSchema
          .optional()
          .describe('End of the range, inclusive, e.g. "step:5" or 60000.'),
        kinds: z
          .array(z.enum(KINDS))
          .min(1)
          .optional()
          .describe(
            'Only these kinds, e.g. ["step", "network"]. Default: all.'
          ),
        tabId: z.number().int().min(0).optional().describe("Only this tab."),
        offset: z.number().int().min(0).optional().describe("Default: 0."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`Default: ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) =>
      runTool("get_timeline", async () => {
        const id = resolveReportId(input.report)
        const kinds = new Set<Kind>(input.kinds?.length ? input.kinds : KINDS)
        const { events, requests } = await loadSources(deps, {
          id,
          kinds,
          needsSteps: input.from !== undefined || input.to !== undefined,
          tabId: input.tabId,
        })

        const range = resolveRange(
          input.from,
          input.to,
          events.actions.map((action) => action.offset)
        )

        const entries = buildEntries({
          events,
          requests: requests?.items ?? [],
          kinds,
        }).filter(
          (entry) =>
            (input.tabId === undefined || entry.item.tabId === input.tabId) &&
            isInRange(entry.offsetMs, range)
        )

        const offset = input.offset ?? 0
        const limit = clampInteger(input.limit, {
          min: 1,
          max: MAX_LIMIT,
          fallback: DEFAULT_LIMIT,
        })
        const missing = requests ? describeMissingRequests(requests) : null

        return pagedResult({
          total: entries.length,
          extra: {
            countsByKind: countByKind(entries),
            ...describeRange(range),
            ...(missing ? { warning: missing } : {}),
          },
          offset,
          items: entries
            .slice(offset, offset + limit)
            .map((entry) => entry.item),
        })
      })
  )
}

/**
 * Reads only what the kinds and range need. The debugger read runs first: it
 * enforces access, and its NOT_FOUND is the error the caller should see.
 */
async function loadSources(
  deps: ToolDependencies,
  input: { id: string; kinds: Set<Kind>; needsSteps: boolean; tabId?: number }
): Promise<{ events: DebuggerEvents; requests: AllNetworkRequests | null }> {
  const needsEvents =
    input.needsSteps || input.kinds.has("step") || input.kinds.has("console")
  const events: DebuggerEvents = needsEvents
    ? await deps.reader.getDebuggerEvents(input.id)
    : { actions: [], logs: [] }
  const requests = input.kinds.has("network")
    ? await fetchAllNetworkRequests(deps.reader, {
        id: input.id,
        tabId: input.tabId,
      })
    : null
  return { events, requests }
}

interface Range {
  from: number | null
  to: number | null
}

function describeRange(range: Range) {
  if (range.from === null && range.to === null) {
    return {}
  }
  return {
    range: {
      fromMs: range.from,
      from: formatOffset(range.from),
      toMs: range.to,
      to: formatOffset(range.to),
    },
  }
}

function resolveRange(
  from: FrameRequest | undefined,
  to: FrameRequest | undefined,
  stepOffsets: (number | null)[]
): Range {
  const resolveEnd = (value: FrameRequest | undefined): number | null => {
    if (value === undefined) {
      return null
    }
    const resolved = resolveMoment(value, stepOffsets)
    if (!resolved.ok) {
      throw new ToolInputError(resolved.message)
    }
    return resolved.target.offsetMs
  }

  const range = { from: resolveEnd(from), to: resolveEnd(to) }
  if (range.from !== null && range.to !== null && range.to < range.from) {
    throw new ToolInputError(
      `\`from\` (${formatOffset(range.from)}) must not be after \`to\` (${formatOffset(range.to)}).`
    )
  }
  return range
}

/**
 * Events without an offset happened before the recording started, so they
 * fall before any `from` and before every `to`.
 */
function isInRange(offsetMs: number | null, range: Range): boolean {
  if (offsetMs === null) {
    return range.from === null
  }
  return (
    (range.from === null || offsetMs >= range.from) &&
    (range.to === null || offsetMs <= range.to)
  )
}

/**
 * Merges the three lists by offsetMs, the time in the video, so the offsets
 * the caller reads only go up. Events without an offset happened before the
 * recording started and come first. Ties (several events clamped to 0 by a
 * trim, or in the same millisecond) fall back to the wall-clock timestamp,
 * then to the kind.
 */
function buildEntries(input: {
  events: DebuggerEvents
  requests: NetworkRequestItem[]
  kinds: Set<Kind>
}): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  if (input.kinds.has("step")) {
    for (const [index, action] of input.events.actions.entries()) {
      entries.push({
        timestamp: action.timestamp,
        offsetMs: action.offset,
        item: { kind: "step", ...toStepItem(action, index) },
      })
    }
  }

  if (input.kinds.has("console")) {
    for (const log of input.events.logs) {
      entries.push({
        timestamp: log.timestamp,
        offsetMs: log.offset,
        item: {
          kind: "console",
          ...toLogItem(log, {
            includeMetadata: false,
            messageMaxChars: LOG_MESSAGE_MAX_CHARS,
          }),
        },
      })
    }
  }

  if (input.kinds.has("network")) {
    for (const request of input.requests) {
      entries.push({
        timestamp: request.timestamp,
        offsetMs: request.offset,
        item: { kind: "network", ...toNetworkItem(request) },
      })
    }
  }

  return entries.sort(
    (a, b) =>
      compareTime(a, b) || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind]
  )
}

function compareTime(a: TimelineEntry, b: TimelineEntry): number {
  const byOffset = (a.offsetMs ?? -1) - (b.offsetMs ?? -1)
  if (byOffset !== 0) {
    return byOffset
  }
  const aMs = Date.parse(a.timestamp)
  const bMs = Date.parse(b.timestamp)
  return Number.isFinite(aMs) && Number.isFinite(bMs) ? aMs - bMs : 0
}

function countByKind(entries: TimelineEntry[]): Record<Kind, number> {
  const counts: Record<Kind, number> = { step: 0, console: 0, network: 0 }
  for (const entry of entries) {
    counts[entry.item.kind] += 1
  }
  return counts
}
