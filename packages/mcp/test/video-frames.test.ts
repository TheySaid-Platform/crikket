import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { spawn } from "node:child_process"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
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

  it("cuts exact frames, reports targets past the end, and caches them", async () => {
    const cacheDir = join(workDir, "cache-a")
    let downloads = 0
    const service = createVideoFrameService({
      cacheDir,
      ffmpeg,
      loadCapture: () => {
        downloads += 1
        return Promise.resolve(video)
      },
    })

    const frames = await service.getVideoFrames({
      reportId: "rpt_video",
      captureKey: "capture/rpt_video",
      targetsMs: [1000, 2500, 5900, 9000],
    })

    expect(frames.map((frame) => frame.targetMs)).toEqual([
      1000, 2500, 5900, 9000,
    ])
    for (const frame of frames.slice(0, 3)) {
      expect(frame.frameMs).not.toBeNull()
      expect((frame.frameMs ?? 0) - frame.targetMs).toBeGreaterThanOrEqual(-2)
      expect((frame.frameMs ?? 0) - frame.targetMs).toBeLessThan(40)
      // JPEG magic bytes.
      expect([...(frame.image ?? []).slice(0, 2)]).toEqual([0xff, 0xd8])
    }
    expect(frames[3]).toMatchObject({ frameMs: null, image: null })

    // A second service on the same cache with a broken ffmpeg proves the
    // repeat call never runs ffmpeg or downloads again.
    const cachedOnly = createVideoFrameService({
      cacheDir,
      ffmpeg: {
        ffmpegPath: "/nonexistent/ffmpeg",
        nicePath: null,
        timeoutMs: 1000,
      },
      loadCapture: () => Promise.reject(new Error("should not download")),
    })
    const again = await cachedOnly.getVideoFrames({
      reportId: "rpt_video",
      captureKey: "capture/rpt_video",
      targetsMs: [2500, 1000],
    })
    expect(again.map((frame) => frame.frameMs)).toEqual([
      frames[1]?.frameMs ?? -1,
      frames[0]?.frameMs ?? -1,
    ])
    expect(downloads).toBe(1)
  })

  it("shares one download and decode between concurrent requests", async () => {
    let downloads = 0
    const service = createVideoFrameService({
      cacheDir: join(workDir, "cache-b"),
      ffmpeg,
      loadCapture: () => {
        downloads += 1
        return Promise.resolve(video)
      },
    })

    const [a, b] = await Promise.all([
      service.getVideoFrames({
        reportId: "rpt_same",
        captureKey: "k",
        targetsMs: [3000],
      }),
      service.getVideoFrames({
        reportId: "rpt_same",
        captureKey: "k",
        targetsMs: [3000],
      }),
    ])

    expect(downloads).toBe(1)
    expect(a[0]?.frameMs).toBe(b[0]?.frameMs ?? -1)
  })

  it("shrinks a tall screenshot to fit image limits", async () => {
    const service = createVideoFrameService({
      cacheDir: join(workDir, "cache-c"),
      ffmpeg,
      loadCapture: () => Promise.resolve(screenshot),
    })
    const image = await service.getScreenshot({
      reportId: "rpt_shot",
      captureKey: "k",
    })

    expect([...image.slice(0, 2)]).toEqual([0xff, 0xd8])
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
    const [width, height] = probe.trim().split(",").map(Number)
    expect(width).toBeLessThanOrEqual(1280)
    expect(height).toBeLessThanOrEqual(7900)
  })

  it("never leaves partial files or work folders behind", async () => {
    const files = await readdir(join(workDir, "cache-a", "rpt_video"))
    expect(files.some((name) => name.includes("partial"))).toBe(false)
    expect(files).not.toContain("work")
  })
})
