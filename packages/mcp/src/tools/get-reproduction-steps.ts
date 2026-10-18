import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { clampInteger, pagedResult } from "../format"
import { toStepItem } from "../views"
import {
  READ_ONLY_ANNOTATIONS,
  reportInputSchema,
  resolveReportId,
  runTool,
  type ToolDependencies,
} from "./shared"

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

export function registerGetReproductionStepsTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_reproduction_steps",
    {
      title: "Get reproduction steps",
      description:
        "Get what the user did while recording, in order: clicks, typing (only how many characters, never the text), changes, page navigations and tab switches, each with its time in the recording and page URL.",
      inputSchema: {
        report: reportInputSchema,
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
      runTool("get_reproduction_steps", async () => {
        const id = resolveReportId(input.report)
        const { actions } = await deps.reader.getDebuggerEvents(id)
        const steps = actions
          .map(toStepItem)
          .filter(
            (step) => input.tabId === undefined || step.tabId === input.tabId
          )
        const offset = input.offset ?? 0
        const limit = clampInteger(input.limit, {
          min: 1,
          max: MAX_LIMIT,
          fallback: DEFAULT_LIMIT,
        })

        return pagedResult({
          total: steps.length,
          offset,
          items: steps.slice(offset, offset + limit),
        })
      })
  )
}
