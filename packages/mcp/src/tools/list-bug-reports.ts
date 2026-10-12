import {
  BUG_REPORT_SORT_OPTIONS,
  BUG_REPORT_STATUS_OPTIONS,
  BUG_REPORT_VISIBILITY_OPTIONS,
} from "@crikket/shared/constants/bug-report"
import { PRIORITY_OPTIONS } from "@crikket/shared/constants/priorities"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { jsonResult } from "../format"
import { toReportListItem } from "../views"
import { READ_ONLY_ANNOTATIONS, runTool, type ToolDependencies } from "./shared"

const statusValues = Object.values(BUG_REPORT_STATUS_OPTIONS)
const priorityValues = Object.values(PRIORITY_OPTIONS)
const visibilityValues = Object.values(BUG_REPORT_VISIBILITY_OPTIONS)
const sortValues = Object.values(BUG_REPORT_SORT_OPTIONS)

export function registerListBugReportsTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "list_bug_reports",
    {
      title: "List bug reports",
      description:
        "List bug reports in the organization this access key belongs to, newest first. Filter by text, status, priority or visibility. Returns ids and share links to pass to the other tools.",
      inputSchema: {
        search: z
          .string()
          .max(200)
          .optional()
          .describe("Text to find in the title, description or page URL."),
        statuses: z.array(z.enum(statusValues)).optional(),
        priorities: z.array(z.enum(priorityValues)).optional(),
        visibility: z.enum(visibilityValues).optional(),
        sort: z.enum(sortValues).optional().describe("Default: newest."),
        page: z.number().int().min(1).optional().describe("Default: 1."),
        perPage: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Default: 20, max 50."),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) =>
      runTool("list_bug_reports", async () => {
        const result = await deps.reader.listReports({
          search: input.search,
          statuses: input.statuses,
          priorities: input.priorities,
          visibilities: input.visibility ? [input.visibility] : undefined,
          sort: input.sort ?? BUG_REPORT_SORT_OPTIONS.newest,
          page: input.page ?? 1,
          perPage: input.perPage ?? 20,
        })

        return jsonResult({
          items: result.items.map((item) =>
            toReportListItem(item, deps.appOrigin)
          ),
          pagination: result.pagination,
        })
      })
  )
}
