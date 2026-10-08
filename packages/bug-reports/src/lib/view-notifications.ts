import { sendBugReportViewedEmail } from "@crikket/auth/lib/email/index"
import { db } from "@crikket/db"
import { member } from "@crikket/db/schema/auth"
import { bugReportView } from "@crikket/db/schema/bug-report"
import { and, asc, eq, isNull, lt, lte, sql } from "drizzle-orm"
import {
  BUG_REPORT_VIEW_NOTIFICATION_MAX_ATTEMPTS,
  calculateBugReportViewNotificationRetryDelayMs,
  describeBugReportTitle,
  describeBugReportViewer,
  truncateBugReportViewNotifyError,
} from "./view-notification-policy"

const BUG_REPORT_VIEW_NOTIFICATION_DEFAULT_BATCH = 20
// A claimed row is skipped by other servers until this passes, so a crash
// mid-send retries later instead of never.
const BUG_REPORT_VIEW_NOTIFICATION_CLAIM_MS = 10 * 60 * 1000

type ViewNotificationResult = "failed" | "sent" | "skipped"

export async function runBugReportViewNotificationPass(options?: {
  limit?: number
}): Promise<{ failed: number; sent: number; skipped: number }> {
  const dueViews = await db.query.bugReportView.findMany({
    where: pendingNotificationWhere(new Date()),
    orderBy: [asc(bugReportView.nextNotifyAttemptAt)],
    limit: options?.limit ?? BUG_REPORT_VIEW_NOTIFICATION_DEFAULT_BATCH,
    columns: { id: true },
  })

  const counts = { failed: 0, sent: 0, skipped: 0 }

  for (const view of dueViews) {
    const result = await processBugReportViewNotification(view.id)
    counts[result] += 1
  }

  return counts
}

function pendingNotificationWhere(now: Date) {
  return and(
    isNull(bugReportView.notifiedAt),
    lt(bugReportView.notifyAttempts, BUG_REPORT_VIEW_NOTIFICATION_MAX_ATTEMPTS),
    lte(bugReportView.nextNotifyAttemptAt, now)
  )
}

async function processBugReportViewNotification(
  viewId: string
): Promise<ViewNotificationResult> {
  const [claimed] = await db
    .update(bugReportView)
    .set({
      notifyAttempts: sql`${bugReportView.notifyAttempts} + 1`,
      nextNotifyAttemptAt: new Date(
        Date.now() + BUG_REPORT_VIEW_NOTIFICATION_CLAIM_MS
      ),
    })
    .where(
      and(eq(bugReportView.id, viewId), pendingNotificationWhere(new Date()))
    )
    .returning({ attempts: bugReportView.notifyAttempts })

  if (!claimed) {
    return "skipped"
  }

  const view = await db.query.bugReportView.findFirst({
    where: eq(bugReportView.id, viewId),
    with: {
      viewer: { columns: { name: true, email: true } },
      bugReport: {
        columns: { id: true, organizationId: true, title: true },
        with: { reporter: { columns: { id: true, email: true } } },
      },
    },
  })
  const reporter = view?.bugReport.reporter

  // A reporter who has left the organization must not hear about its reports.
  if (
    !(
      view &&
      reporter &&
      (await isOrganizationMember({
        organizationId: view.bugReport.organizationId,
        userId: reporter.id,
      }))
    )
  ) {
    await markBugReportViewNotified(viewId)
    return "skipped"
  }

  try {
    await sendBugReportViewedEmail({
      email: reporter.email,
      reportId: view.bugReport.id,
      reportTitle: describeBugReportTitle(view.bugReport.title),
      viewerDescription: describeBugReportViewer({
        viewerKey: view.viewerKey,
        viewer: view.viewer,
      }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      `[bug-report-view-notification] send failed for view ${viewId} (attempt ${claimed.attempts} of ${BUG_REPORT_VIEW_NOTIFICATION_MAX_ATTEMPTS})`,
      message
    )
    await db
      .update(bugReportView)
      .set({
        lastNotifyError: truncateBugReportViewNotifyError(message),
        nextNotifyAttemptAt: new Date(
          Date.now() +
            calculateBugReportViewNotificationRetryDelayMs(claimed.attempts)
        ),
      })
      .where(eq(bugReportView.id, viewId))
    return "failed"
  }

  // Outside the try: if this write fails after a send, the row waits out the
  // claim instead of being re-sent on the short retry delay.
  await markBugReportViewNotified(viewId)
  return "sent"
}

async function isOrganizationMember(input: {
  organizationId: string
  userId: string
}): Promise<boolean> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, input.organizationId),
      eq(member.userId, input.userId)
    ),
    columns: { id: true },
  })

  return Boolean(membership)
}

async function markBugReportViewNotified(viewId: string): Promise<void> {
  await db
    .update(bugReportView)
    .set({ notifiedAt: new Date(), lastNotifyError: null })
    .where(eq(bugReportView.id, viewId))
}
