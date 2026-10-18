import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import { formatOffset } from "../format"
import {
  describeTarget,
  type FrameRequest,
  type FrameTarget,
  resolveFrameTarget,
} from "../media/targets"
import type { VideoFrame, VideoFrameService } from "../media/video-frames"
import {
  READ_ONLY_ANNOTATIONS,
  reportInputSchema,
  resolveReportId,
  runTool,
  type ToolDependencies,
  ToolInputError,
} from "./shared"

const MAX_FRAMES_PER_CALL = 12
const DEFAULT_WINDOW_COUNT = 6
const DEFAULT_OVERVIEW_COUNT = 12
const SIZES = [360, 720, 1080] as const
const DEFAULT_SIZE = 720
const STEP_WORD_PATTERN = /step/i

type Content = CallToolResult["content"][number]

const momentSchema = z.union([
  z.string().trim().min(1).max(40),
  z.number().int().min(0),
])

export function registerGetVideoFramesTool(
  server: McpServer,
  deps: ToolDependencies
) {
  server.registerTool(
    "get_video_frames",
    {
      title: "Get video frames",
      description:
        'See the screen of a bug report\'s video. Pick one mode: `overview` (default) returns one grid image of 12 moments across the whole video, the fastest way to orient; `at` returns up to 12 frames at given moments; `window` returns evenly spaced frames between two moments. A moment is a number of milliseconds (like offsetMs in the other tools), a time like "1:05" or "45s", or a step like "step:7" (taken just after the step, to show its result). For a screenshot report it returns the screenshot. The recording\'s audio is not available.',
      inputSchema: {
        report: reportInputSchema,
        overview: z
          .boolean()
          .optional()
          .describe("One grid image of 12 moments spread across the video."),
        at: z
          .array(momentSchema)
          .min(1)
          .max(MAX_FRAMES_PER_CALL)
          .optional()
          .describe('Moments to show, e.g. ["step:3", 45000, "1:05"].'),
        window: z
          .object({
            from: momentSchema,
            to: momentSchema,
            count: z
              .number()
              .int()
              .min(2)
              .max(MAX_FRAMES_PER_CALL)
              .optional()
              .describe(`Default: ${DEFAULT_WINDOW_COUNT}.`),
          })
          .optional()
          .describe("Evenly spaced frames from `from` to `to`."),
        size: z
          .union([z.literal(360), z.literal(720), z.literal(1080)])
          .optional()
          .describe(
            `Frame height in pixels for \`at\` and \`window\`: ${SIZES.join(", ")}. Default: ${DEFAULT_SIZE}.`
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

        const modeCount = countModes(input)
        const id = resolveReportId(input.report)
        // Enforces access, like every other read.
        const source = await deps.reader.getCaptureSource(id)
        const captureKey = requireVideoOrScreenshot(source)

        if (source.attachmentType === "screenshot") {
          const image = await frames.getScreenshot({ reportId: id, captureKey })
          return screenshotResult(id, image, modeCount > 0)
        }

        if (!(input.at || input.window)) {
          return overviewResult(frames, { id, captureKey })
        }

        const { targets, problems } = input.window
          ? await resolveWindow(deps, { id, window: input.window })
          : await resolveTargets(deps, { at: input.at ?? [], id })
        if (targets.length === 0) {
          throw new ToolInputError(problems.join(" "))
        }

        const result = await frames.getVideoFrames({
          reportId: id,
          captureKey,
          targetsMs: targets.map((target) => target.offsetMs),
          height: input.size ?? DEFAULT_SIZE,
        })

        return framesResult({
          durationMs: result.durationMs ?? source.durationMs,
          id,
          problems,
          requested: input.at?.length ?? targets.length,
          results: result.frames,
          targets,
        })
      })
  )
}

function countModes(input: {
  overview?: boolean
  at?: unknown
  window?: unknown
}): number {
  const count = [input.overview, input.at, input.window].filter(
    (mode) => mode !== undefined && mode !== false
  ).length
  if (count > 1) {
    throw new ToolInputError(
      "Use one of `overview`, `at` or `window` per call."
    )
  }
  return count
}

/** Returns the capture key, or explains why there are no frames to cut. */
function requireVideoOrScreenshot(source: {
  attachmentType: string | null
  captureKey: string | null
}): string {
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
  return source.captureKey
}

async function overviewResult(
  frames: VideoFrameService,
  input: { id: string; captureKey: string }
): Promise<CallToolResult> {
  const { durationMs, overview } = await frames.getOverview({
    reportId: input.id,
    captureKey: input.captureKey,
    count: DEFAULT_OVERVIEW_COUNT,
  })
  if (!overview) {
    throw new ToolInputError(
      'Could not read this video\'s length, so no overview can be made. Ask for moments with `at`, e.g. ["0:05", "step:3"].'
    )
  }

  const rows = Array.from({ length: overview.rows }, (_, row) =>
    overview.framesMs
      .slice(row * overview.columns, (row + 1) * overview.columns)
      .map((frameMs) => `${formatOffset(frameMs)} (${frameMs} ms)`)
      .join(", ")
  )
  const length = durationMs ? `, ${formatOffset(durationMs)} long` : ""
  const text = [
    `Overview of bug report ${input.id}${length}: ${overview.framesMs.length} frames in a ${overview.columns} x ${overview.rows} grid, read left to right, top to bottom.`,
    ...rows.map((times, row) => `Row ${row + 1}: ${times}.`),
    "Ask for a closer look with `at` or `window`.",
  ].join("\n")

  return {
    content: [{ type: "text", text }, imageContent(overview.image)],
  }
}

/** Step offsets, loaded only when one of the moments names a step. */
async function loadStepOffsets(
  deps: ToolDependencies,
  id: string,
  moments: FrameRequest[]
): Promise<(number | null)[]> {
  const needsSteps = moments.some(
    (value) => typeof value === "string" && STEP_WORD_PATTERN.test(value)
  )
  if (!needsSteps) {
    return []
  }
  const { actions } = await deps.reader.getDebuggerEvents(id)
  return actions.map((action) => action.offset)
}

async function resolveWindow(
  deps: ToolDependencies,
  input: {
    id: string
    window: { from: FrameRequest; to: FrameRequest; count?: number }
  }
): Promise<{ targets: FrameTarget[]; problems: string[] }> {
  const { window } = input
  const stepOffsets = await loadStepOffsets(deps, input.id, [
    window.from,
    window.to,
  ])
  const from = resolveFrameTarget(window.from, stepOffsets)
  const to = resolveFrameTarget(window.to, stepOffsets)
  const problems = [from, to].flatMap((end) => (end.ok ? [] : [end.message]))
  if (!(from.ok && to.ok)) {
    return { targets: [], problems }
  }

  const fromMs = from.target.offsetMs
  const toMs = to.target.offsetMs
  if (toMs <= fromMs) {
    return {
      targets: [],
      problems: [
        `The window needs \`from\` before \`to\`; ${describeTarget(from.target)} is not before ${describeTarget(to.target)}.`,
      ],
    }
  }

  const count = window.count ?? DEFAULT_WINDOW_COUNT
  const stepMs = (toMs - fromMs) / (count - 1)
  return {
    targets: Array.from({ length: count }, (_, index) => {
      const offsetMs = Math.round(fromMs + stepMs * index)
      return { label: formatOffset(offsetMs) ?? "", offsetMs, step: null }
    }),
    problems: [],
  }
}

async function resolveTargets(
  deps: ToolDependencies,
  input: { at: FrameRequest[]; id: string }
): Promise<{ targets: FrameTarget[]; problems: string[] }> {
  const stepOffsets = await loadStepOffsets(deps, input.id, input.at)

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
      text: `${describeTarget(target)}: frame at ${formatOffset(result.frameMs)} (${result.frameMs} ms)`,
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

function imageContent(image: Uint8Array): Content {
  return {
    type: "image",
    data: Buffer.from(image).toString("base64"),
    mimeType: "image/jpeg",
  }
}
