import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { ORPCError } from "@orpc/server"
import { z } from "zod"

import { errorResult } from "../format"
import { MediaTimeoutError, MediaToolUnavailableError } from "../media/ffmpeg"
import { MediaBusyError } from "../media/gate"
import type { VideoFrameService } from "../media/video-frames"
import type { CrikketReader } from "../reader"
import { parseReportRef } from "../report-ref"

export interface ToolDependencies {
  appOrigin: string
  reader: CrikketReader
  /** Cuts frames from videos; absent when the server cannot do it. */
  frames?: VideoFrameService
}

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

export const reportInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .describe(
    "Bug report id, or its Crikket share link (e.g. https://crikket.example.com/s/gVQoTvqv0vRo)."
  )

export class ToolInputError extends Error {}

export function resolveReportId(report: string): string {
  const parsed = parseReportRef(report)
  if (!parsed.ok) {
    throw new ToolInputError(parsed.message)
  }

  return parsed.id
}

const NOT_FOUND_HINT =
  "It does not exist, or it is private to an organization this access key does not belong to."

export async function runTool(
  toolName: string,
  run: () => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    return await run()
  } catch (error) {
    return errorResult(describeToolError(toolName, error))
  }
}

function describeToolError(toolName: string, error: unknown): string {
  if (error instanceof ToolInputError) {
    return error.message
  }

  if (error instanceof MediaToolUnavailableError) {
    return error.message
  }

  if (error instanceof MediaBusyError) {
    return "Another video is being processed on this server. Try again in a minute."
  }

  if (error instanceof MediaTimeoutError) {
    return "Cutting frames took too long; long videos are slow to read near the end. Ask for earlier moments, or try again."
  }

  if (error instanceof ORPCError) {
    if (error.code === "NOT_FOUND") {
      return error.message === "Bug report not found"
        ? `${error.message}. ${NOT_FOUND_HINT}`
        : `${error.message}.`
    }

    if (
      error.code === "BAD_REQUEST" ||
      error.code === "UNAUTHORIZED" ||
      error.code === "FORBIDDEN" ||
      error.code === "TOO_MANY_REQUESTS"
    ) {
      return error.message
    }
  }

  console.error(`[mcp] ${toolName} failed`, error)
  return "Something went wrong while reading from Crikket. Try again in a moment."
}
