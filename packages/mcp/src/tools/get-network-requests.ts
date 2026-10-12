import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { clampInteger, isFailedNetworkRequest, pagedResult } from "../format"
import { fetchAllNetworkRequests } from "../network"
import { toNetworkItem } from "../views"
import {
  READ_ONLY_ANNOTATIONS,
  reportInputSchema,
  resolveReportId,
  runTool,
  type ToolDependencies,
} from "./shared"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function registerGetNetworkRequestsTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_network_requests",
    {
      title: "Get network requests",
      description:
        "Get the network requests captured with a bug report, in time order: method, URL, status, failure reason and duration. Use failedOnly to see only errors (status 0 or 400+, or a network failure). Use get_network_request_details for headers and bodies.",
      inputSchema: {
        report: reportInputSchema,
        failedOnly: z.boolean().optional().describe("Default: false."),
        method: z
          .string()
          .max(10)
          .optional()
          .describe("Only this HTTP method, e.g. POST."),
        search: z
          .string()
          .max(200)
          .optional()
          .describe(
            "Only requests whose method, URL or status contains this text."
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
      runTool("get_network_requests", async () => {
        const id = resolveReportId(input.report)
        const requests = await fetchAllNetworkRequests(deps.reader, {
          id,
          search: input.search?.trim() || undefined,
          tabId: input.tabId,
        })
        const method = input.method?.trim().toUpperCase() || null
        const matching = requests.filter(
          (request) =>
            (!input.failedOnly || isFailedNetworkRequest(request)) &&
            (!method || request.method.toUpperCase() === method)
        )
        const offset = input.offset ?? 0
        const limit = clampInteger(input.limit, {
          min: 1,
          max: MAX_LIMIT,
          fallback: DEFAULT_LIMIT,
        })

        return pagedResult({
          total: matching.length,
          extra: {
            failedTotal: requests.filter(isFailedNetworkRequest).length,
          },
          offset,
          items: matching.slice(offset, offset + limit).map(toNetworkItem),
        })
      })
  )
}
