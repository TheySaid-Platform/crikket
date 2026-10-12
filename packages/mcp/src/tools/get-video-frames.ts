import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import { formatOffset } from "../format"
import {
  describeTarget,
  type FrameTarget,
  resolveFrameTarget,
} from "../media/targets"
import type { VideoFrame } from "../media/video-frames"
import {
  READ_ONLY_ANNOTATIONS,
  reportInputSchema,
  resolveReportId,
  runTool,
  type ToolDependencies,
  ToolInputError,
} from "./shared"

const MAX_FRAMES_PER_CALL = 6
const STEP_WORD_PATTERN = /step/i
/** Used when the caller does not say which moments to look at. */
const DEFAULT_SPREAD = [0.1, 0.35, 0.6, 0.85]

type Content = CallToolResult["content"][number]

export function registerGetVideoFramesTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_video_frames",
    {
      title: "Get video frames",
      description:
        'See the screen. Returns still images from a bug report\'s video at up to 6 moments: a time like "1:05", "45s" or 45 (seconds), or a step like "step:7" (taken just after the step, to show its result). Steps are numbered as in get_bug_context and get_reproduction_steps. For a screenshot report it returns the screenshot. The recording\'s audio is not available.',
      inputSchema: {
        report: reportInputSchema,
        at: z
          .array(z.union([z.string().trim().max(40), z.number().min(0)]))
          .min(1)
          .max(MAX_FRAMES_PER_CALL)
          .optional()
          .describe(
            'Moments to show, e.g. ["step:3", "1:05", 12.5]. If left out, four moments spread across the video.'
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input) =>
      runTool("get_video_frames", async () => {
        const { frames } = deps
        if (!frames) {
          throw new ToolInputError(
            "Video frames are not available on this server."
          )
        }

        const id = resolveReportId(input.report)
        // Enforces access, like every other read.
        const source = await deps.reader.getCaptureSource(id)
        if (!source.captureKey) {
          throw new ToolInputError(
            "This bug report has no video or screenshot attached."
          )
        }

        if (source.attachmentType === "replay") {
          throw new ToolInputError(
            "This report is an instant replay (a recording of the page itself, not a video), so there are no video frames. Use get_reproduction_steps, get_console_logs and get_network_requests instead."
          )
        }

        if (source.attachmentType === "screenshot") {
          const image = await frames.getScreenshot({
            reportId: id,
            captureKey: source.captureKey,
          })
          return screenshotResult(id, image, Boolean(input.at))
        }

        const { targets, problems } = await resolveTargets(deps, {
          at: input.at,
          durationMs: source.durationMs,
          id,
        })
        if (targets.length === 0) {
          throw new ToolInputError(problems.join(" "))
        }

        const results = await frames.getVideoFrames({
          reportId: id,
          captureKey: source.captureKey,
          targetsMs: targets.map((target) => target.offsetMs),
        })

        return framesResult({
          durationMs: source.durationMs,
          id,
          problems,
          requested: input.at?.length ?? targets.length,
          results,
          targets,
        })
      })
  )
}

function screenshotResult(
  id: string,
  image: Uint8Array,
  momentsRequested: boolean
): CallToolResult {
  const note = momentsRequested
    ? " It is a single image, so the requested moments do not apply."
    : ""
  return {
    content: [
      { type: "text", text: `Screenshot from bug report ${id}.${note}` },
      imageContent(image),
    ],
  }
}

function framesResult(input: {
  durationMs: number | null
  id: string
  problems: string[]
  requested: number
  results: VideoFrame[]
  targets: FrameTarget[]
}): CallToolResult {
  const problems = [...input.problems]
  const content: Content[] = []
  const videoLength = input.durationMs
    ? ` (${formatOffset(input.durationMs)} long)`
    : ""

  for (const [index, target] of input.targets.entries()) {
    const result = input.results[index]
    if (!result?.image || result.frameMs === null) {
      problems.push(
        `${describeTarget(target)} is past the end of the video${videoLength}.`
      )
      continue
    }
    content.push({
      type: "text",
      text: `${describeTarget(target)}: frame at ${formatOffset(result.frameMs)}`,
    })
    content.push(imageContent(result.image))
  }

  const shown = content.filter((item) => item.type === "image").length
  const header = [
    `Frames from bug report ${input.id}: showing ${shown} of ${input.requested} requested moments.`,
    ...problems,
  ].join(" ")
  return { content: [{ type: "text", text: header }, ...content] }
}

async function resolveTargets(
  deps: ToolDependencies,
  input: { at?: (string | number)[]; durationMs: number | null; id: string }
): Promise<{ targets: FrameTarget[]; problems: string[] }> {
  if (!input.at) {
    if (!input.durationMs) {
      throw new ToolInputError(
        'Say which moments to show with `at`, e.g. ["step:3", "0:45"]; this video\'s length is unknown.'
      )
    }
    const durationMs = input.durationMs
    return {
      targets: DEFAULT_SPREAD.map((share) => {
        const offsetMs = Math.round(durationMs * share)
        return { label: formatOffset(offsetMs) ?? "", offsetMs, step: null }
      }),
      problems: [],
    }
  }

  const needsSteps = input.at.some(
    (value) => typeof value === "string" && STEP_WORD_PATTERN.test(value)
  )
  const stepOffsets = needsSteps
    ? (await deps.reader.getDebuggerEvents(input.id)).actions.map(
        (action) => action.offset
      )
    : []

  const targets: FrameTarget[] = []
  const problems: string[] = []
  for (const value of input.at) {
    const resolved = resolveFrameTarget(value, stepOffsets)
    if (resolved.ok) {
      targets.push(resolved.target)
    } else {
      problems.push(resolved.message)
    }
  }
  return { targets, problems }
}

function imageContent(image: Uint8Array): Content {
  return {
    type: "image",
    data: Buffer.from(image).toString("base64"),
    mimeType: "image/jpeg",
  }
}
