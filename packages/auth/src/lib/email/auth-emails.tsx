/** @jsxImportSource react */
import { env } from "@crikket/env/server"
import { sendAuthEmail } from "./send-auth-email"
import { BugReportViewedTemplate } from "./templates/bug-report-viewed-template"
import { OrganizationInvitationTemplate } from "./templates/organization-invitation-template"

type SendBugReportViewedEmailInput = {
  email: string
  reportId: string
  reportTitle: string
  viewerDescription: string
}

type SendOrganizationInvitationEmailInput = {
  email: string
  invitationId: string
  organizationName: string
  inviterName: string
  role: string
}

const appUrl = env.CORS_ORIGINS[0]

if (!appUrl) {
  throw new Error(
    "CORS_ORIGINS must include a frontend origin for auth email links."
  )
}

const toAppUrl = (urlOrPath: string): string => {
  const parsed = new URL(urlOrPath, appUrl)
  const appRelativeUrl = `${parsed.pathname}${parsed.search}${parsed.hash}`

  return new URL(appRelativeUrl, appUrl).toString()
}

export const sendOrganizationInvitationEmail = async ({
  email,
  invitationId,
  organizationName,
  inviterName,
  role,
}: SendOrganizationInvitationEmailInput): Promise<void> => {
  const invitationUrl = toAppUrl(`/invite/${invitationId}`)

  await sendAuthEmail({
    to: email,
    subject: `You're invited to join ${organizationName}`,
    text: `${inviterName} invited you to join ${organizationName} as ${role}. Open this invitation: ${invitationUrl}`,
    react: (
      <OrganizationInvitationTemplate
        invitationUrl={invitationUrl}
        inviterName={inviterName}
        organizationName={organizationName}
        role={role}
      />
    ),
  })
}

export const sendBugReportViewedEmail = async ({
  email,
  reportId,
  reportTitle,
  viewerDescription,
}: SendBugReportViewedEmailInput): Promise<void> => {
  const reportUrl = toAppUrl(`/s/${reportId}`)

  await sendAuthEmail({
    to: email,
    subject: `${viewerDescription} opened your recording "${reportTitle}"`,
    text: `${viewerDescription} opened your recording "${reportTitle}". Open it: ${reportUrl}`,
    react: (
      <BugReportViewedTemplate
        reportTitle={reportTitle}
        reportUrl={reportUrl}
        viewerDescription={viewerDescription}
      />
    ),
  })
}
