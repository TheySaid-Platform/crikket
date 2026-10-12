import { z } from "zod"

const bugReportArtifactKindValues = [
  "capture",
  "thumbnail",
  "debugger",
] as const

export const bugReportArtifactKindSchema = z.enum(bugReportArtifactKindValues)

export type BugReportArtifactKind = z.infer<typeof bugReportArtifactKindSchema>

const CAPTURE_FILENAMES = {
  video: "video.webm",
  screenshot: "screenshot.png",
  replay: "replay.json.gz",
} as const

export function buildCaptureArtifactKey(input: {
  organizationId: string
  bugReportId: string
  captureType: keyof typeof CAPTURE_FILENAMES
}): string {
  return (
    buildBugReportArtifactBasePath(input) + CAPTURE_FILENAMES[input.captureType]
  )
}

export function buildThumbnailArtifactKey(input: {
  organizationId: string
  bugReportId: string
}): string {
  return `${buildBugReportArtifactBasePath(input)}thumbnail.png`
}

export function buildDebuggerArtifactKey(input: {
  organizationId: string
  bugReportId: string
}): string {
  const basePath = buildBugReportBasePath(input)
  return `${basePath}/debugger/payload.json.gz`
}

function buildBugReportArtifactBasePath(input: {
  organizationId: string
  bugReportId: string
}): string {
  const basePath = buildBugReportBasePath(input)
  return `${basePath}/capture/`
}

function buildBugReportBasePath(input: {
  organizationId: string
  bugReportId: string
}): string {
  return `organizations/${input.organizationId}/bug-reports/${input.bugReportId}`
}
