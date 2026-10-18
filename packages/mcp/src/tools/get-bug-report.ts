import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

import { jsonResult } from "../format"
import { toReportSummary } from "../views"
import {
  READ_ONLY_ANNOTATIONS,
  reportInputSchema,
  resolveReportId,
  runTool,
  type ToolDependencies,
} from "./shared"

export function registerGetBugReportTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_bug_report",
    {
      title: "Get bug report",
      description:
        "Get one bug report's details: title, description, status, the page it was recorded on, browser and device, open tabs, and a link to the video or screenshot. For logs, steps and failed requests in one call, use get_bug_context.",
      inputSchema: { report: reportInputSchema },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) =>
      runTool("get_bug_report", async () => {
        const report = await deps.reader.getReport(
          resolveReportId(input.report)
        )
        return jsonResult(toReportSummary(report, deps.appOrigin))
      })
  )
}
