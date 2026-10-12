import { spawn } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { mkdir, readdir, readFile, rm } from "node:fs/promises"
import { delimiter, join } from "node:path"

const PTS_TIME_PATTERN = /pts_time:(-?\d+(?:\.\d+)?)/g
const FRAME_WIDTH = 1280
/** Keeps very tall long-screenshots inside image limits for vision models. */
const MAX_IMAGE_HEIGHT = 7900
const JPEG_QUALITY = "4"
/** Decode a little past the last target, then stop reading the file. */
const DECODE_TAIL_SECONDS = 1

export class MediaToolUnavailableError extends Error {}
export class MediaTimeoutError extends Error {}

export interface FfmpegOptions {
  ffmpegPath: string
  /** Runs ffmpeg at a lower CPU priority than the API, when `nice` exists. */
  nicePath: string | null
  timeoutMs: number
}

/** Finds an executable on PATH, like `which`. */
export function findExecutable(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) {
      continue
    }
    const candidate = join(dir, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Not in this directory.
    }
  }
  return null
}

export function findFfmpegOptions(timeoutMs: number): FfmpegOptions | null {
  const ffmpegPath = findExecutable("ffmpeg")
  if (!ffmpegPath) {
    return null
  }
  return { ffmpegPath, nicePath: findExecutable("nice"), timeoutMs }
}

/**
 * Picks the first frame at or after each target time. Recordings from the
 * browser have no seek index, so ffmpeg decodes from the start; one term pair
 * per target keeps it to a single pass. ffmpeg's expression parser rejects
 * this at about 100 targets, far above the few a tool call asks for.
 */
export function buildFrameSelectExpression(offsetsMs: number[]): string {
  return offsetsMs
    .map((offsetMs) => {
      const seconds = (offsetMs / 1000).toFixed(3)
      return `gte(t,${seconds})*lt(prev_pts*TB,${seconds})`
    })
    .join("+")
}

/** Matches each target to the first extracted frame at or after it. */
export function matchFramesToTargets(
  targetsMs: number[],
  frameTimesMs: number[]
): Map<number, number | null> {
  const sortedFrames = [...frameTimesMs].sort((a, b) => a - b)
  const matches = new Map<number, number | null>()

  for (const targetMs of targetsMs) {
    // A frame's timestamp can sit a millisecond before the target after
    // rounding, so allow a tiny tolerance.
    const index = sortedFrames.findIndex((frameMs) => frameMs >= targetMs - 2)
    matches.set(targetMs, index === -1 ? null : (sortedFrames[index] ?? null))
  }

  return matches
}

async function runFfmpeg(
  options: FfmpegOptions,
  args: string[]
): Promise<string> {
  const command = options.nicePath
    ? [options.nicePath, "-n", "10", options.ffmpegPath, ...args]
    : [options.ffmpegPath, ...args]
  const [executable, ...commandArgs] = command
  if (!executable) {
    throw new Error("No ffmpeg command")
  }

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, commandArgs, {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, options.timeoutMs)

    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (exitCode) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(
          new MediaTimeoutError(
            `ffmpeg took longer than ${Math.round(options.timeoutMs / 1000)} s`
          )
        )
      } else if (exitCode === 0) {
        resolve(stderr)
      } else {
        reject(
          new Error(`ffmpeg exited with ${exitCode}: ${stderr.slice(-500)}`)
        )
      }
    })
  })
}

/**
 * Extracts one JPEG per target, 1280 px wide. Returns each target's frame
 * time and image; a target past the end of the video has no frame.
 */
export async function extractVideoFrames(input: {
  options: FfmpegOptions
  videoPath: string
  workDir: string
  targetsMs: number[]
}): Promise<Map<number, { frameMs: number; image: Uint8Array } | null>> {
  const targetsMs = [...new Set(input.targetsMs)].sort((a, b) => a - b)
  const lastTargetSeconds = (targetsMs.at(-1) ?? 0) / 1000

  await rm(input.workDir, { recursive: true, force: true })
  await mkdir(input.workDir, { recursive: true })

  try {
    const stderr = await runFfmpeg(input.options, [
      "-hide_banner",
      "-nostdin",
      "-threads",
      "1",
      "-i",
      input.videoPath,
      "-an",
      "-filter_threads",
      "1",
      "-vf",
      `select='${buildFrameSelectExpression(targetsMs)}',scale='min(${FRAME_WIDTH},iw)':-2,showinfo`,
      "-fps_mode",
      "vfr",
      "-to",
      String(lastTargetSeconds + DECODE_TAIL_SECONDS),
      "-q:v",
      JPEG_QUALITY,
      join(input.workDir, "%04d.jpg"),
    ])

    // showinfo prints one line per frame that reached the output, in order.
    const frameTimesMs = [...stderr.matchAll(PTS_TIME_PATTERN)].map((match) =>
      Math.round(Number(match[1]) * 1000)
    )
    const files = (await readdir(input.workDir))
      .filter((name) => name.endsWith(".jpg"))
      .sort()
    const imagesByFrameMs = new Map<number, Uint8Array>()
    for (const [index, name] of files.entries()) {
      const frameMs = frameTimesMs[index]
      if (frameMs !== undefined) {
        imagesByFrameMs.set(
          frameMs,
          new Uint8Array(await readFile(join(input.workDir, name)))
        )
      }
    }

    const matches = matchFramesToTargets(targetsMs, [...imagesByFrameMs.keys()])
    const result = new Map<
      number,
      { frameMs: number; image: Uint8Array } | null
    >()
    for (const [targetMs, frameMs] of matches) {
      const image = frameMs === null ? undefined : imagesByFrameMs.get(frameMs)
      result.set(
        targetMs,
        frameMs === null || !image ? null : { frameMs, image }
      )
    }
    return result
  } finally {
    await rm(input.workDir, { recursive: true, force: true })
  }
}

/** Converts a screenshot to a JPEG that fits vision-model limits. */
export async function convertScreenshot(input: {
  options: FfmpegOptions
  imagePath: string
  outputPath: string
}): Promise<Uint8Array> {
  await runFfmpeg(input.options, [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input.imagePath,
    "-vf",
    `scale='min(${FRAME_WIDTH},iw)':'min(${MAX_IMAGE_HEIGHT},ih)':force_original_aspect_ratio=decrease`,
    "-frames:v",
    "1",
    "-q:v",
    JPEG_QUALITY,
    input.outputPath,
  ])
  try {
    return new Uint8Array(await readFile(input.outputPath))
  } finally {
    await rm(input.outputPath, { force: true })
  }
}
