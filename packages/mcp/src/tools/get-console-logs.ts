import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { clampInteger, pagedResult } from "../format"
import { toLogItem } from "../views"
import {
  READ_ONLY_ANNOTATIONS,
  reportInputSchema,
  resolveReportId,
  runTool,
  type ToolDependencies,
} from "./shared"

const LOG_LEVELS = ["error", "warn", "info", "log", "debug"] as const
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export function registerGetConsoleLogsTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_console_logs",
    {
      title: "Get console logs",
      description:
        "Get the browser console output captured with a bug report, in time order. Filter by level, text or tab, and page with offset and limit.",
      inputSchema: {
        report: reportInputSchema,
        levels: z
          .array(z.enum(LOG_LEVELS))
          .optional()
          .describe('Only these levels, e.g. ["error", "warn"]. Default: all.'),
        search: z
          .string()
          .max(200)
          .optional()
          .describe("Only messages containing this text (case-insensitive)."),
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
      runTool("get_console_logs", async () => {
        const id = resolveReportId(input.report)
        const { logs } = await deps.reader.getDebuggerEvents(id)
        const levels = input.levels?.length ? new Set(input.levels) : null
        const search = input.search?.trim().toLowerCase() || null

        const matching = logs.filter(
          (log) =>
            (!levels || levels.has(log.level as (typeof LOG_LEVELS)[number])) &&
            (!search || log.message.toLowerCase().includes(search)) &&
            (input.tabId === undefined || log.tabId === input.tabId)
        )
        const offset = input.offset ?? 0
        const limit = clampInteger(input.limit, {
          min: 1,
          max: MAX_LIMIT,
          fallback: DEFAULT_LIMIT,
        })

        return pagedResult({
          total: matching.length,
          extra: { countsByLevel: countByLevel(logs) },
          offset,
          items: matching
            .slice(offset, offset + limit)
            .map((log) => toLogItem(log)),
        })
      })
  )
}

function countByLevel(logs: { level: string }[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const log of logs) {
    counts[log.level] = (counts[log.level] ?? 0) + 1
  }
  return counts
}
