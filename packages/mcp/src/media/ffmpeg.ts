import { spawn } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { delimiter, join } from "node:path"

const PTS_TIME_PATTERN = /pts_time:(-?\d+(?:\.\d+)?)/
/** Keeps very tall long-screenshots inside image limits for vision models. */
const MAX_IMAGE_HEIGHT = 7900
const MAX_IMAGE_WIDTH = 1280
const JPEG_QUALITY = "4"

export class MediaToolUnavailableError extends Error {}
export class MediaTimeoutError extends Error {}

export interface FfmpegOptions {
  ffmpegPath: string
  ffprobePath: string
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
  const ffprobePath = findExecutable("ffprobe")
  if (!(ffmpegPath && ffprobePath)) {
    return null
  }
  return {
    ffmpegPath,
    ffprobePath,
    nicePath: findExecutable("nice"),
    timeoutMs,
  }
}

function runProcess(
  options: FfmpegOptions,
  executable: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const [command, ...commandArgs] = options.nicePath
    ? [options.nicePath, "-n", "10", executable, ...args]
    : [executable, ...args]

  return new Promise((resolve, reject) => {
    const child = spawn(command ?? executable, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, options.timeoutMs)

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
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
        resolve({ stdout, stderr })
      } else {
        reject(
          new Error(`ffmpeg exited with ${exitCode}: ${stderr.slice(-500)}`)
        )
      }
    })
  })
}

/**
 * Browser recordings are WebM with no seek index, so jumping to a time means
 * decoding from the start. Copying the video stream into Matroska (no
 * re-encode) writes that index once; after it, each frame costs only a
 * decode from the nearest keyframe.
 */
export async function remuxForSeeking(input: {
  options: FfmpegOptions
  sourcePath: string
  outputPath: string
}): Promise<void> {
  await runProcess(input.options, input.options.ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input.sourcePath,
    "-map",
    "0:v:0",
    "-c",
    "copy",
    "-f",
    "matroska",
    input.outputPath,
  ])
}

export async function probeDurationMs(input: {
  options: FfmpegOptions
  path: string
}): Promise<number | null> {
  const { stdout } = await runProcess(
    input.options,
    input.options.ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      input.path,
    ]
  )
  const seconds = Number(stdout.trim())
  return Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : null
}

/**
 * Writes the first frame at or after `targetMs` as a JPEG `height` px tall
 * (never upscaled). Returns the frame's time, or null when the target is past
 * the last frame.
 */
export async function extractFrameAt(input: {
  options: FfmpegOptions
  videoPath: string
  targetMs: number
  height: number
  outputPath: string
}): Promise<number | null> {
  await rm(input.outputPath, { force: true })
  const { stderr } = await runProcess(input.options, input.options.ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-threads",
    "1",
    "-ss",
    (input.targetMs / 1000).toFixed(3),
    // Keep the video's own timestamps so showinfo reports the real time.
    "-copyts",
    "-i",
    input.videoPath,
    "-an",
    "-frames:v",
    "1",
    "-vf",
    `scale=-2:'min(${input.height},ih)',showinfo`,
    "-q:v",
    JPEG_QUALITY,
    input.outputPath,
  ])

  const match = PTS_TIME_PATTERN.exec(stderr)
  if (!match) {
    return null
  }
  try {
    await readFile(input.outputPath)
  } catch {
    return null
  }
  return Math.round(Number(match[1]) * 1000)
}

/** Tiles equally sized JPEGs, named 01.jpg, 02.jpg, …, into one grid. */
export async function buildGrid(input: {
  options: FfmpegOptions
  framesDir: string
  columns: number
  rows: number
  outputPath: string
}): Promise<Uint8Array> {
  await runProcess(input.options, input.options.ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-framerate",
    "1",
    "-i",
    join(input.framesDir, "%02d.jpg"),
    "-vf",
    `tile=${input.columns}x${input.rows}:padding=4:color=white`,
    "-frames:v",
    "1",
    "-q:v",
    JPEG_QUALITY,
    input.outputPath,
  ])
  return new Uint8Array(await readFile(input.outputPath))
}

/** Converts a screenshot to a JPEG that fits vision-model limits. */
export async function convertScreenshot(input: {
  options: FfmpegOptions
  imagePath: string
  outputPath: string
}): Promise<Uint8Array> {
  await runProcess(input.options, input.options.ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    input.imagePath,
    "-vf",
    `scale='min(${MAX_IMAGE_WIDTH},iw)':'min(${MAX_IMAGE_HEIGHT},ih)':force_original_aspect_ratio=decrease`,
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
