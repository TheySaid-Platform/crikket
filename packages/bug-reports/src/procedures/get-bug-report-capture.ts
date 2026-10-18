import { db } from "@crikket/db"
import { bugReport } from "@crikket/db/schema/bug-report"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"

import {
  assertBugReportAccessById,
  bugReportIdInputSchema,
  isAttachmentType,
} from "../lib/utils"
import { o } from "./context"

/**
 * Where a report's video or screenshot is stored, after the same access check
 * as the share page. Used by the MCP server, which reads the file on the
 * server to cut still frames; the key is never sent to a client.
 */
export const getBugReportCaptureSource = o
  .input(bugReportIdInputSchema)
  .handler(async ({ context, input }) => {
    await assertBugReportAccessById({
      id: input.id,
      session: context.session,
    })

    const report = await db.query.bugReport.findFirst({
      where: eq(bugReport.id, input.id),
      columns: {
        id: true,
        attachmentType: true,
        captureKey: true,
        captureContentType: true,
        captureSizeBytes: true,
        metadata: true,
      },
    })

    if (!report) {
      throw new ORPCError("NOT_FOUND", { message: "Bug report not found" })
    }

    const metadata = report.metadata as Record<string, unknown> | null
    const durationMs =
      typeof metadata?.durationMs === "number" ? metadata.durationMs : null

    return {
      id: report.id,
      attachmentType: isAttachmentType(report.attachmentType)
        ? report.attachmentType
        : null,
      captureKey: report.captureKey,
      captureContentType: report.captureContentType,
      captureSizeBytes: report.captureSizeBytes,
      durationMs,
    }
  })
