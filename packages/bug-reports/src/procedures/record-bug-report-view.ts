import { db } from "@crikket/db"
import { bugReport, bugReportView } from "@crikket/db/schema/bug-report"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { assertBugReportAccessById, bugReportIdInputSchema } from "../lib/utils"
import {
  getBugReportViewerKey,
  shouldRecordBugReportView,
} from "../lib/view-notification-policy"
import { o } from "./context"

/**
 * Records that the viewer opened the report. The first open per viewer queues
 * an email to the reporter, which runBugReportViewNotificationPass sends.
 */
export const recordBugReportView = o
  .input(bugReportIdInputSchema)
  .handler(async ({ context, input }) => {
    await assertBugReportAccessById({
      id: input.id,
      session: context.session,
    })

    const report = await db.query.bugReport.findFirst({
      where: eq(bugReport.id, input.id),
      columns: { reporterId: true, submissionStatus: true },
    })
    const viewerUserId = context.session?.user.id

    if (
      !shouldRecordBugReportView({
        reporterId: report?.reporterId ?? null,
        submissionStatus: report?.submissionStatus ?? "",
        viewerUserId,
      })
    ) {
      return
    }

    await db
      .insert(bugReportView)
      .values({
        id: nanoid(16),
        bugReportId: input.id,
        viewerKey: getBugReportViewerKey(viewerUserId),
        viewerUserId: viewerUserId ?? null,
      })
      .onConflictDoNothing()
  })
