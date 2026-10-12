import { tmpdir } from "node:os"
import { join } from "node:path"

import { type CachedFrame, MediaCache } from "./cache"
import {
  convertScreenshot,
  extractVideoFrames,
  type FfmpegOptions,
  findFfmpegOptions,
  MediaToolUnavailableError,
} from "./ffmpeg"
import { createGate } from "./gate"

const CACHE_MAX_BYTES = 1024 * 1024 * 1024
const CACHE_MAX_AGE_MS = 30 * 60 * 1000
const FFMPEG_TIMEOUT_MS = 60 * 1000
/** How long a request waits for another video to finish in this pod. */
const GATE_WAIT_MS = 45 * 1000

export interface VideoFrame {
  targetMs: number
  /** Time of the frame actually returned; null when past the video's end. */
  frameMs: number | null
  image: Uint8Array | null
}

export interface VideoFrameService {
  getVideoFrames(input: {
    reportId: string
    captureKey: string
    targetsMs: number[]
  }): Promise<VideoFrame[]>
  getScreenshot(input: {
    reportId: string
    captureKey: string
  }): Promise<Uint8Array>
}

/**
 * Cuts still frames from a report's video on demand. Everything heavy is
 * bounded: one ffmpeg at a time per pod at low priority with a timeout, and
 * a temp-disk cache so repeat questions cost nothing.
 */
export function createVideoFrameService(input: {
  loadCapture: (captureKey: string) => Promise<Uint8Array>
  cacheDir?: string
  ffmpeg?: FfmpegOptions | null
}): VideoFrameService {
  const ffmpeg =
    input.ffmpeg === undefined
      ? findFfmpegOptions(FFMPEG_TIMEOUT_MS)
      : input.ffmpeg
  const cache = new MediaCache({
    rootDir: input.cacheDir ?? join(tmpdir(), "crikket-mcp-media"),
    maxBytes: CACHE_MAX_BYTES,
    maxAgeMs: CACHE_MAX_AGE_MS,
  })
  const runGated = createGate(1)

  const requireFfmpeg = (): FfmpegOptions => {
    if (!ffmpeg) {
      throw new MediaToolUnavailableError(
        "Video frames are not available on this server (ffmpeg is not installed)."
      )
    }
    return ffmpeg
  }

  const ensureCapture = async (
    reportId: string,
    captureKey: string,
    name: string
  ): Promise<string> => {
    const path = join(cache.reportDir(reportId), name)
    if (!(await cache.hasFile(reportId, name))) {
      await cache.writeFile(reportId, name, await input.loadCapture(captureKey))
    }
    return path
  }

  const cacheMissingFrames = async (frameInput: {
    reportId: string
    captureKey: string
    index: Record<string, CachedFrame>
    missing: number[]
    options: FfmpegOptions
  }) => {
    const { reportId, captureKey, index, missing, options } = frameInput
    // The download is gated too, so a pod never holds more than one video in
    // memory at a time.
    const extracted = await runGated(GATE_WAIT_MS, async () =>
      extractVideoFrames({
        options,
        videoPath: await ensureCapture(reportId, captureKey, "video.webm"),
        workDir: join(cache.reportDir(reportId), "work"),
        targetsMs: missing,
      })
    )
    for (const targetMs of missing) {
      const frame = extracted.get(targetMs) ?? null
      if (frame) {
        await cache.writeFile(reportId, `${targetMs}.jpg`, frame.image)
      }
      index[String(targetMs)] = { frameMs: frame?.frameMs ?? null }
    }
    await cache.writeFrameIndex(reportId, index)
    await cache.prune(reportId)
  }

  const readCachedFrames = async (
    reportId: string,
    targetsMs: number[],
    index: Record<string, CachedFrame>
  ): Promise<VideoFrame[]> => {
    const frames: VideoFrame[] = []
    for (const targetMs of targetsMs) {
      const frameMs = index[String(targetMs)]?.frameMs ?? null
      frames.push({
        targetMs,
        frameMs,
        image:
          frameMs === null
            ? null
            : await cache.readFile(reportId, `${targetMs}.jpg`),
      })
    }
    return frames
  }

  return {
    getVideoFrames: ({ reportId, captureKey, targetsMs }) =>
      cache.withReportLock(reportId, async () => {
        const options = requireFfmpeg()
        await cache.touch(reportId)
        const index = await cache.readFrameIndex(reportId)
        const missing = [...new Set(targetsMs)].filter(
          (targetMs) => !(String(targetMs) in index)
        )

        if (missing.length > 0) {
          await cacheMissingFrames({
            reportId,
            captureKey,
            index,
            missing,
            options,
          })
        }

        return await readCachedFrames(reportId, targetsMs, index)
      }),

    getScreenshot: ({ reportId, captureKey }) =>
      cache.withReportLock(reportId, async () => {
        const options = requireFfmpeg()
        await cache.touch(reportId)
        const cached = await cache.readFile(reportId, "screenshot.jpg")
        if (cached) {
          return cached
        }

        const image = await runGated(GATE_WAIT_MS, async () =>
          convertScreenshot({
            options,
            imagePath: await ensureCapture(
              reportId,
              captureKey,
              "screenshot-original"
            ),
            outputPath: join(cache.reportDir(reportId), "screenshot.work.jpg"),
          })
        )
        await cache.writeFile(reportId, "screenshot.jpg", image)
        await cache.prune(reportId)
        return image
      }),
  }
}
