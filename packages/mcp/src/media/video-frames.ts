import { copyFile, mkdir, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type CachedFrame, MediaCache } from "./cache"
import {
  buildGrid,
  convertScreenshot,
  extractFrameAt,
  type FfmpegOptions,
  findFfmpegOptions,
  MediaToolUnavailableError,
  probeDurationMs,
  remuxForSeeking,
} from "./ffmpeg"
import { createGate } from "./gate"

const CACHE_MAX_BYTES = 1024 * 1024 * 1024
const CACHE_MAX_AGE_MS = 30 * 60 * 1000
const FFMPEG_TIMEOUT_MS = 60 * 1000
/** How long a request waits for another video to finish in this pod. */
const GATE_WAIT_MS = 45 * 1000
const SEEKABLE_VIDEO = "video.mkv"
const VIDEO_META = "video.json"
export const OVERVIEW_TILE_HEIGHT = 180
const OVERVIEW_COLUMNS = 4

export interface VideoFrame {
  targetMs: number
  /** Time of the frame actually returned; null when past the video's end. */
  frameMs: number | null
  image: Uint8Array | null
}

export interface VideoOverview {
  /** Frame times in reading order: left to right, then top to bottom. */
  framesMs: number[]
  columns: number
  rows: number
  image: Uint8Array
}

export interface VideoFrameService {
  getVideoFrames(input: {
    reportId: string
    captureKey: string
    targetsMs: number[]
    height: number
  }): Promise<{ durationMs: number | null; frames: VideoFrame[] }>
  getOverview(input: {
    reportId: string
    captureKey: string
    count: number
  }): Promise<{ durationMs: number | null; overview: VideoOverview | null }>
  getScreenshot(input: {
    reportId: string
    captureKey: string
  }): Promise<Uint8Array>
}

interface SeekableVideo {
  path: string
  durationMs: number | null
}

/**
 * Cuts still frames from a report's video on demand. The first request for
 * a report streams the video to the pod's temp disk and copies it into a
 * seekable file once; after that each frame decodes only from its nearest
 * keyframe. One ffmpeg job runs at a time per pod, at low priority, with a
 * timeout, and frames are cached so repeat questions cost nothing.
 */
export function createVideoFrameService(input: {
  /** Streams a stored capture into a local file. */
  downloadCapture: (
    captureKey: string,
    destinationPath: string
  ) => Promise<void>
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

  const readDuration = async (reportId: string): Promise<number | null> => {
    const data = await cache.readFile(reportId, VIDEO_META)
    if (!data) {
      return null
    }
    const meta = JSON.parse(new TextDecoder().decode(data)) as {
      durationMs?: number | null
    }
    return meta.durationMs ?? null
  }

  /** Downloads and remuxes once; returns the seekable file and its length. */
  const ensureSeekableVideo = async (
    options: FfmpegOptions,
    reportId: string,
    captureKey: string
  ): Promise<SeekableVideo> => {
    const path = join(cache.reportDir(reportId), SEEKABLE_VIDEO)
    if (await cache.hasFile(reportId, SEEKABLE_VIDEO)) {
      return { path, durationMs: await readDuration(reportId) }
    }

    const sourcePath = await cache.writeFileWith(
      reportId,
      "source.webm",
      (temporaryPath) => input.downloadCapture(captureKey, temporaryPath)
    )
    try {
      await cache.writeFileWith(reportId, SEEKABLE_VIDEO, (temporaryPath) =>
        remuxForSeeking({ options, sourcePath, outputPath: temporaryPath })
      )
    } finally {
      await rm(sourcePath, { force: true })
    }

    const durationMs = await probeDurationMs({ options, path })
    await cache.writeFile(
      reportId,
      VIDEO_META,
      new TextEncoder().encode(JSON.stringify({ durationMs }))
    )
    return { path, durationMs }
  }

  const framePath = (reportId: string, height: number, targetMs: number) =>
    join(cache.reportDir(reportId), `frame-${height}-${targetMs}.jpg`)

  /** Cuts the frames not cached yet, updating `index` in place. */
  const cutMissingFrames = async (frameInput: {
    options: FfmpegOptions
    reportId: string
    video: SeekableVideo
    targetsMs: number[]
    height: number
    index: Record<string, CachedFrame>
  }) => {
    const { options, reportId, video, height, index } = frameInput
    for (const targetMs of frameInput.targetsMs) {
      const key = `${height}:${targetMs}`
      if (key in index) {
        continue
      }
      if (video.durationMs !== null && targetMs > video.durationMs) {
        index[key] = { frameMs: null }
        continue
      }
      const finalPath = framePath(reportId, height, targetMs)
      const workPath = `${finalPath}.work.jpg`
      const frameMs = await extractFrameAt({
        options,
        videoPath: video.path,
        targetMs,
        height,
        outputPath: workPath,
      })
      if (frameMs === null) {
        await rm(workPath, { force: true })
      } else {
        await rename(workPath, finalPath)
      }
      index[key] = { frameMs }
    }
    await cache.writeFrameIndex(reportId, index)
  }

  const readFrames = async (
    reportId: string,
    targetsMs: number[],
    height: number,
    index: Record<string, CachedFrame>
  ): Promise<VideoFrame[]> => {
    const frames: VideoFrame[] = []
    for (const targetMs of targetsMs) {
      const frameMs = index[`${height}:${targetMs}`]?.frameMs ?? null
      frames.push({
        targetMs,
        frameMs,
        image:
          frameMs === null
            ? null
            : await cache.readFile(reportId, `frame-${height}-${targetMs}.jpg`),
      })
    }
    return frames
  }

  const buildOverview = async (
    options: FfmpegOptions,
    reportId: string,
    video: SeekableVideo,
    count: number
  ): Promise<{ durationMs: number | null; overview: VideoOverview | null }> => {
    if (!video.durationMs) {
      return { durationMs: video.durationMs, overview: null }
    }
    const durationMs = video.durationMs
    const targetsMs = Array.from({ length: count }, (_, position) =>
      Math.floor(((position + 0.5) * durationMs) / count)
    )
    const index = await cache.readFrameIndex(reportId)
    await cutMissingFrames({
      options,
      reportId,
      video,
      targetsMs,
      height: OVERVIEW_TILE_HEIGHT,
      index,
    })
    const frames = targetsMs
      .map((targetMs) => ({
        targetMs,
        frameMs: index[`${OVERVIEW_TILE_HEIGHT}:${targetMs}`]?.frameMs ?? null,
      }))
      .filter((frame) => frame.frameMs !== null)
    if (frames.length === 0) {
      return { durationMs, overview: null }
    }

    const columns = Math.min(OVERVIEW_COLUMNS, frames.length)
    const rows = Math.ceil(frames.length / columns)
    const gridDir = join(cache.reportDir(reportId), "grid")
    await rm(gridDir, { recursive: true, force: true })
    await mkdir(gridDir, { recursive: true })
    try {
      for (const [position, frame] of frames.entries()) {
        await copyFile(
          framePath(reportId, OVERVIEW_TILE_HEIGHT, frame.targetMs),
          join(gridDir, `${String(position + 1).padStart(2, "0")}.jpg`)
        )
      }
      const image = await buildGrid({
        options,
        framesDir: gridDir,
        columns,
        rows,
        outputPath: join(gridDir, "overview.jpg"),
      })
      return {
        durationMs,
        overview: {
          framesMs: frames.map((frame) => frame.frameMs ?? 0),
          columns,
          rows,
          image,
        },
      }
    } finally {
      await rm(gridDir, { recursive: true, force: true })
    }
  }

  return {
    getVideoFrames: ({ reportId, captureKey, targetsMs, height }) =>
      cache.withReportLock(reportId, async () => {
        const options = requireFfmpeg()
        await cache.touch(reportId)
        const index = await cache.readFrameIndex(reportId)
        const allCached = targetsMs.every(
          (targetMs) => `${height}:${targetMs}` in index
        )

        if (!allCached) {
          await runGated(GATE_WAIT_MS, async () => {
            const video = await ensureSeekableVideo(
              options,
              reportId,
              captureKey
            )
            await cutMissingFrames({
              options,
              reportId,
              video,
              targetsMs,
              height,
              index,
            })
          })
          await cache.prune(reportId)
        }

        return {
          durationMs: await readDuration(reportId),
          frames: await readFrames(reportId, targetsMs, height, index),
        }
      }),

    getOverview: ({ reportId, captureKey, count }) =>
      cache.withReportLock(reportId, async () => {
        const options = requireFfmpeg()
        await cache.touch(reportId)
        const result = await runGated(GATE_WAIT_MS, async () =>
          buildOverview(
            options,
            reportId,
            await ensureSeekableVideo(options, reportId, captureKey),
            count
          )
        )
        await cache.prune(reportId)
        return result
      }),

    getScreenshot: ({ reportId, captureKey }) =>
      cache.withReportLock(reportId, async () => {
        const options = requireFfmpeg()
        await cache.touch(reportId)
        const cached = await cache.readFile(reportId, "screenshot.jpg")
        if (cached) {
          return cached
        }

        const image = await runGated(GATE_WAIT_MS, async () => {
          const imagePath = await cache.writeFileWith(
            reportId,
            "screenshot-original",
            (temporaryPath) => input.downloadCapture(captureKey, temporaryPath)
          )
          return convertScreenshot({
            options,
            imagePath,
            outputPath: join(cache.reportDir(reportId), "screenshot.work.jpg"),
          })
        })
        await cache.writeFile(reportId, "screenshot.jpg", image)
        await cache.prune(reportId)
        return image
      }),
  }
}
