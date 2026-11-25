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

/** A date alone means midnight UTC; a date-time needs its time zone. */
const dateSchema = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .optional()

function parseDate(value: string | undefined): Date | undefined {
  return value ? new Date(value) : undefined
}

export function registerListBugReportsTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "list_bug_reports",
    {
      title: "List bug reports",
      description:
        "List bug reports in the organization this access key belongs to (newest first unless `sort` says otherwise). Filter by text, status, priority, visibility, tags, creation date, or reports you reported (`mine`); filters combine with AND. Returns ids and share links to pass to the other tools.",
      inputSchema: {
        search: z
          .string()
          .max(200)
          .optional()
          .describe("Text to find in the title, description or page URL."),
        statuses: z.array(z.enum(statusValues)).optional(),
        priorities: z.array(z.enum(priorityValues)).optional(),
        visibility: z.enum(visibilityValues).optional(),
        tags: z
          .array(z.string().trim().min(1).max(40))
          .min(1)
          .max(20)
          .optional()
          .describe(
            "Reports carrying any of these tags (exact, case-sensitive names, as list items show them)."
          ),
        createdAfter: dateSchema.describe(
          'Created at or after this time: an ISO date or date-time, e.g. "2026-11-01" (midnight UTC) or "2026-11-01T14:00:00Z" (a date-time needs its time zone).'
        ),
        createdBefore: dateSchema.describe(
          'Created strictly before this time: an ISO date or date-time, e.g. "2026-11-08".'
        ),
        mine: z
          .boolean()
          .optional()
          .describe(
            "Only reports reported by the user this access key belongs to."
          ),
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
          tags: input.tags,
          createdAfter: parseDate(input.createdAfter),
          createdBefore: parseDate(input.createdBefore),
          mine: input.mine,
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
