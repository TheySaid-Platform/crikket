import { db } from "@crikket/db"
import { bugReport } from "@crikket/db/schema/bug-report"
import {
  PRIORITY_OPTIONS,
  type Priority,
} from "@crikket/shared/constants/priorities"
import { ORPCError } from "@orpc/server"
import { eq } from "drizzle-orm"
import { readReplayFile } from "../lib/replay"
import { getStorageProvider, resolveCaptureUrl } from "../lib/storage"
import {
  assertBugReportAccessById,
  assertVisibilityAccess,
  bugReportIdInputSchema,
  isStatus,
  statusValues,
} from "../lib/utils"
import { o } from "./context"

const priorityValues = Object.values(PRIORITY_OPTIONS) as [
  Priority,
  ...Priority[],
]

export const getBugReportById = o
  .input(bugReportIdInputSchema)
  .handler(async ({ context, input }) => {
    await assertBugReportAccessById({
      id: input.id,
      session: context.session,
    })

    const report = await db.query.bugReport.findFirst({
      where: eq(bugReport.id, input.id),
      with: {
        reporter: true,
        organization: true,
      },
    })

    if (!report) {
      throw new ORPCError("NOT_FOUND", { message: "Bug report not found" })
    }

    const visibility = assertVisibilityAccess({
      organizationId: report.organizationId,
      session: context.session,
      visibility: report.visibility,
    })
    const activeOrgId = context.session?.session.activeOrganizationId
    const canEdit =
      Boolean(context.session?.user) &&
      Boolean(activeOrgId) &&
      activeOrgId === report.organizationId

    const status = isStatus(report.status) ? report.status : statusValues[0]
    const priority = priorityValues.includes(report.priority as Priority)
      ? (report.priority as Priority)
      : PRIORITY_OPTIONS.none
    const attachmentUrl = await resolveCaptureUrl({
      captureKey: report.captureKey,
    })

    return {
      id: report.id,
      title: report.title,
      description: report.description,
      status,
      priority,
      tags: Array.isArray(report.tags) ? report.tags : [],
      url: report.url,
      attachmentUrl,
      attachmentType: report.attachmentType,
      submissionStatus: report.submissionStatus,
      debuggerIngestionStatus: report.debuggerIngestionStatus,
      debuggerIngestionError: report.debuggerIngestionError,
      visibility,
      canEdit,
      deviceInfo: report.deviceInfo,
      metadata: report.metadata,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      reporter: report.reporter
        ? {
            name: report.reporter.name,
            image: report.reporter.image,
          }
        : null,
      organization: {
        name: report.organization.name,
        logo: report.organization.logo,
      },
    }
  })

/**
 * The rrweb events of an instant replay, as the stored gzipped JSON file.
 * Read through the server, so the report page does not depend on the
 * bucket's CORS rules.
 */
export const getBugReportReplay = o
  .input(bugReportIdInputSchema)
  .handler(async ({ context, input }) => {
    await assertBugReportAccessById({
      id: input.id,
      session: context.session,
    })

    const report = await db.query.bugReport.findFirst({
      where: eq(bugReport.id, input.id),
      columns: { attachmentType: true, captureKey: true },
    })
    return readReplayFile(report ?? null, getStorageProvider())
  })
