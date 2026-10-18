import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findFfmpegOptions } from "../src/media/ffmpeg"
import { createVideoFrameService } from "../src/media/video-frames"

// These run real ffmpeg. Machines without it skip them; the server image
// installs it.
const ffmpeg = findFfmpegOptions(30_000)
const describeWithFfmpeg = ffmpeg ? describe : describe.skip

let workDir = ""
let video = new Uint8Array()
let screenshot = new Uint8Array()

function runTool(
  command: string,
  args: string[],
  stdin?: Uint8Array
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr))
    )
    child.stdin?.end(stdin)
  })
}

async function imageSize(image: Uint8Array): Promise<number[]> {
  const probe = await runTool(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      "-",
    ],
    image
  )
  return probe.trim().split(",").map(Number)
}

function generate(args: string[]) {
  return runTool("ffmpeg", ["-hide_banner", "-v", "error", ...args])
}

describeWithFfmpeg("video frame service (real ffmpeg)", () => {
  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "crikket-frames-test-"))
    const videoPath = join(workDir, "input.webm")
    const screenshotPath = join(workDir, "input.png")
    // 6 s VP9 WebM at 30 fps, like the extension records.
    await generate([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=duration=6:size=1920x1080:rate=30",
      "-c:v",
      "libvpx-vp9",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-b:v",
      "500k",
      videoPath,
    ])
    // A tall "long screenshot".
    await generate([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1440x9000",
      "-frames:v",
      "1",
      screenshotPath,
    ])
    video = new Uint8Array(await readFile(videoPath))
    screenshot = new Uint8Array(await readFile(screenshotPath))
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it("cuts exact frames, including at 0:00, reports targets past the end, and caches them", async () => {
    const cacheDir = join(workDir, "cache-a")
    let downloads = 0
    const service = createVideoFrameService({
      cacheDir,
      ffmpeg,
      downloadCapture: async (_key, destination) => {
        downloads += 1
        await writeFile(destination, video)
      },
    })

    const { durationMs, frames } = await service.getVideoFrames({
      reportId: "rpt_video",
      captureKey: "capture/rpt_video",
      targetsMs: [0, 1000, 2500, 5900, 9000],
      height: 720,
    })

    expect(durationMs).toBeGreaterThan(5900)
    expect(durationMs).toBeLessThan(6100)
    expect(frames.map((frame) => frame.targetMs)).toEqual([
      0, 1000, 2500, 5900, 9000,
    ])
    // A target at the very first frame is returned (it used to be missed).
    expect(frames[0]?.frameMs).toBe(0)
    for (const frame of frames.slice(0, 4)) {
      expect(frame.frameMs).not.toBeNull()
      expect((frame.frameMs ?? 0) - frame.targetMs).toBeGreaterThanOrEqual(-2)
      expect((frame.frameMs ?? 0) - frame.targetMs).toBeLessThan(40)
      // JPEG magic bytes.
      expect([...(frame.image ?? []).slice(0, 2)]).toEqual([0xff, 0xd8])
    }
    expect(frames[4]).toMatchObject({ frameMs: null, image: null })

    // A second service on the same cache with a broken ffmpeg proves the
    // repeat call never runs ffmpeg or downloads again.
    const cachedOnly = createVideoFrameService({
      cacheDir,
      ffmpeg: {
        ffmpegPath: "/nonexistent/ffmpeg",
        ffprobePath: "/nonexistent/ffprobe",
        nicePath: null,
        timeoutMs: 1000,
      },
      downloadCapture: () => Promise.reject(new Error("should not download")),
    })
    const again = await cachedOnly.getVideoFrames({
      reportId: "rpt_video",
      captureKey: "capture/rpt_video",
      targetsMs: [2500, 1000],
      height: 720,
    })
    expect(again.frames.map((frame) => frame.frameMs)).toEqual([
      frames[2]?.frameMs ?? -1,
      frames[1]?.frameMs ?? -1,
    ])
    expect(downloads).toBe(1)
  })

  it("shares one download between concurrent requests", async () => {
    let downloads = 0
    const service = createVideoFrameService({
      cacheDir: join(workDir, "cache-b"),
      ffmpeg,
      downloadCapture: async (_key, destination) => {
        downloads += 1
        await writeFile(destination, video)
      },
    })

    const [a, b] = await Promise.all([
      service.getVideoFrames({
        reportId: "rpt_same",
        captureKey: "k",
        targetsMs: [3000],
        height: 360,
      }),
      service.getVideoFrames({
        reportId: "rpt_same",
        captureKey: "k",
        targetsMs: [3000],
        height: 360,
      }),
    ])

    expect(downloads).toBe(1)
    expect(a.frames[0]?.frameMs).toBe(b.frames[0]?.frameMs ?? -1)
  })

  it("leaves no file behind when a download fails", async () => {
    const cacheDir = join(workDir, "cache-d")
    const service = createVideoFrameService({
      cacheDir,
      ffmpeg,
      downloadCapture: async (_key, destination) => {
        await writeFile(destination, video.slice(0, 100))
        throw new Error("connection reset")
      },
    })

    await expect(
      service.getVideoFrames({
        reportId: "rpt_broken",
        captureKey: "k",
        targetsMs: [1000],
        height: 360,
      })
    ).rejects.toThrow("connection reset")
    expect(await readdir(join(cacheDir, "rpt_broken"))).toEqual([])
  })

  it("builds a 4 x 3 overview grid with the frame times", async () => {
    const service = createVideoFrameService({
      cacheDir: join(workDir, "cache-e"),
      ffmpeg,
      downloadCapture: (_key, destination) => writeFile(destination, video),
    })
    const { overview } = await service.getOverview({
      reportId: "rpt_overview",
      captureKey: "k",
      count: 12,
    })

    expect(overview).not.toBeNull()
    expect(overview?.columns).toBe(4)
    expect(overview?.rows).toBe(3)
    expect(overview?.framesMs).toHaveLength(12)
    expect(overview?.framesMs[0]).toBeLessThan(400)
    const [width, height] = await imageSize(overview?.image ?? new Uint8Array())
    // Four 320 x 180 tiles across, three down, with padding.
    expect(width).toBeGreaterThanOrEqual(1280)
    expect(height).toBeGreaterThanOrEqual(540)
    expect(height).toBeLessThan(600)
  })

  it("shrinks a tall screenshot to fit image limits", async () => {
    const service = createVideoFrameService({
      cacheDir: join(workDir, "cache-c"),
      ffmpeg,
      downloadCapture: (_key, destination) =>
        writeFile(destination, screenshot),
    })
    const image = await service.getScreenshot({
      reportId: "rpt_shot",
      captureKey: "k",
    })

    expect([...image.slice(0, 2)]).toEqual([0xff, 0xd8])
    const [width, height] = await imageSize(image)
    expect(width).toBeLessThanOrEqual(1280)
    expect(height).toBeLessThanOrEqual(7900)
  })

  it("never leaves partial files or work folders behind", async () => {
    const files = await readdir(join(workDir, "cache-a", "rpt_video"))
    expect(files.some((name) => name.includes("partial"))).toBe(false)
    expect(files).not.toContain("work")
  })
})
