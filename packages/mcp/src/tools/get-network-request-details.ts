import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { compactJson, jsonResult, truncateText } from "../format"
import { toNetworkItem } from "../views"
import {
  READ_ONLY_ANNOTATIONS,
  reportInputSchema,
  resolveReportId,
  runTool,
  type ToolDependencies,
} from "./shared"

const HEADERS_MAX_CHARS = 8000
const BODY_MAX_CHARS = 20_000

export function registerGetNetworkRequestDetailsTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_network_request_details",
    {
      title: "Get network request details",
      description:
        "Get one network request in full: request and response headers and bodies. Sensitive headers (cookies, authorization, tokens, API keys) were removed when the report was recorded. Get the request id from get_network_requests or get_bug_context.",
      inputSchema: {
        report: reportInputSchema,
        requestId: z.string().trim().min(1).max(100),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) =>
      runTool("get_network_request_details", async () => {
        const request = await deps.reader.getNetworkRequestDetails({
          id: resolveReportId(input.report),
          requestId: input.requestId,
        })

        return jsonResult({
          ...toNetworkItem(request),
          url: request.url,
          requestHeaders: compactJson(
            request.requestHeaders,
            HEADERS_MAX_CHARS
          ),
          responseHeaders: compactJson(
            request.responseHeaders,
            HEADERS_MAX_CHARS
          ),
          requestBody: truncateText(request.requestBody, BODY_MAX_CHARS),
          responseBody: truncateText(request.responseBody, BODY_MAX_CHARS),
        })
      })
  )
}
