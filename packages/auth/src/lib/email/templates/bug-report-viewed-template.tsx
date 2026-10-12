/** @jsxImportSource react */
import { Button, Heading, Text } from "@react-email/components"
import { AuthEmailLayout } from "./auth-email-layout"

type BugReportViewedTemplateProps = {
  viewerDescription: string
  reportTitle: string
  reportUrl: string
}

export function BugReportViewedTemplate({
  viewerDescription,
  reportTitle,
  reportUrl,
}: BugReportViewedTemplateProps) {
  return (
    <AuthEmailLayout
      footerText="You get this email the first time each person opens a recording you made."
      previewText={`${viewerDescription} opened "${reportTitle}".`}
    >
      <Heading style={headingStyle}>Your recording was opened</Heading>
      <Text style={descriptionStyle}>
        {viewerDescription} opened your recording <strong>{reportTitle}</strong>
        .
      </Text>
      <Button href={reportUrl} style={buttonStyle}>
        Open recording
      </Button>
    </AuthEmailLayout>
  )
}

const headingStyle = {
  fontSize: "24px",
  fontWeight: "700",
  letterSpacing: "-0.01em",
  lineHeight: "32px",
  margin: "0 0 8px",
}

const descriptionStyle = {
  color: "#334155",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0 0 20px",
}

const buttonStyle = {
  backgroundColor: "#0f172a",
  borderRadius: "8px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "600",
  padding: "10px 16px",
  textDecoration: "none",
}
