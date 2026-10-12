import { describe, expect, it } from "bun:test"

import {
  buildFrameSelectExpression,
  matchFramesToTargets,
} from "../src/media/ffmpeg"
import { createGate, MediaBusyError } from "../src/media/gate"
import {
  describeTarget,
  resolveFrameTarget,
  STEP_FRAME_DELAY_MS,
} from "../src/media/targets"
import { describeScreenAccess } from "../src/tools/get-bug-context"

const STEPS = [0, 4000, null, 12_500]

function offsetOf(value: string | number): number | null {
  const result = resolveFrameTarget(value, STEPS)
  return result.ok ? result.target.offsetMs : null
}

describe("resolveFrameTarget", () => {
  it("reads clock times, seconds and milliseconds", () => {
    expect(offsetOf("1:05")).toBe(65_000)
    expect(offsetOf("1:05.3")).toBe(65_300)
    expect(offsetOf("1:02:03")).toBe(3_723_000)
    expect(offsetOf("45s")).toBe(45_000)
    expect(offsetOf("12.5")).toBe(12_500)
    expect(offsetOf(12.5)).toBe(12_500)
    expect(offsetOf("1500ms")).toBe(1500)
  })

  it("takes a step's frame just after the step", () => {
    expect(offsetOf("step:2")).toBe(4000 + STEP_FRAME_DELAY_MS)
    expect(offsetOf("Step 4")).toBe(12_500 + STEP_FRAME_DELAY_MS)
    expect(offsetOf("step#1")).toBe(STEP_FRAME_DELAY_MS)
  })

  it("explains steps it cannot show", () => {
    const missing = resolveFrameTarget("step:9", STEPS)
    expect(missing).toMatchObject({ ok: false })
    if (!missing.ok) {
      expect(missing.message).toContain("this report has 4 steps")
    }

    const beforeRecording = resolveFrameTarget("step:3", STEPS)
    expect(beforeRecording).toMatchObject({ ok: false })
    if (!beforeRecording.ok) {
      expect(beforeRecording.message).toContain("before the recording started")
    }
  })

  it("rejects anything else", () => {
    for (const value of ["soon", "1:75", "-3", "step:x", "", -1]) {
      expect(resolveFrameTarget(value, STEPS).ok).toBe(false)
    }
  })

  it("describes targets for captions", () => {
    const step = resolveFrameTarget("step:2", STEPS)
    const time = resolveFrameTarget("0:45", STEPS)
    if (step.ok && time.ok) {
      expect(describeTarget(step.target)).toBe(
        "step 2 (0:04.7, just after the step)"
      )
      expect(describeTarget(time.target)).toBe("0:45 (0:45.0)")
    }
  })
})

describe("ffmpeg helpers", () => {
  it("builds one select term pair per target", () => {
    expect(buildFrameSelectExpression([1000, 45_500])).toBe(
      "gte(t,1.000)*lt(prev_pts*TB,1.000)+gte(t,45.500)*lt(prev_pts*TB,45.500)"
    )
  })

  it("matches each target to the first frame at or after it", () => {
    const matches = matchFramesToTargets(
      [1000, 1010, 45_000, 99_000],
      [1033, 45_030]
    )
    expect(matches.get(1000)).toBe(1033)
    expect(matches.get(1010)).toBe(1033)
    expect(matches.get(45_000)).toBe(45_030)
    expect(matches.get(99_000)).toBe(null)
  })
})

describe("createGate", () => {
  it("runs one task at a time and hands the slot to the next waiter", async () => {
    const runGated = createGate(1)
    const order: string[] = []
    let releaseFirst: () => void = () => undefined
    const first = runGated(1000, async () => {
      order.push("first:start")
      await new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      order.push("first:end")
    })
    const second = runGated(1000, async () => {
      order.push("second:start")
      await Promise.resolve()
    })

    await Promise.resolve()
    expect(order).toEqual(["first:start"])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(["first:start", "first:end", "second:start"])
  })

  it("gives up with MediaBusyError after the wait limit", async () => {
    const runGated = createGate(1)
    let releaseFirst: () => void = () => undefined
    const first = runGated(
      1000,
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
    )

    await expect(
      runGated(20, () => Promise.resolve("late"))
    ).rejects.toBeInstanceOf(MediaBusyError)
    releaseFirst()
    await first
    expect(await runGated(20, () => Promise.resolve("free"))).toBe("free")
  })
})

describe("describeScreenAccess", () => {
  it("suggests the steps before the first error, first failed request and the end", () => {
    expect(
      describeScreenAccess({
        attachmentType: "video",
        stepOffsets: [0, 3000, 6000, 9000, 12_000],
        firstProblemOffsets: [6500, 3100],
      })
    ).toMatchObject({
      tool: "get_video_frames",
      suggestedMoments: ["step:2", "step:3", "step:5"],
    })
  })

  it("says instant replays have no frames", () => {
    expect(
      describeScreenAccess({
        attachmentType: "replay",
        stepOffsets: [0],
        firstProblemOffsets: [],
      })
    ).toMatchObject({ note: expect.stringContaining("instant replay") })
  })

  it("points screenshot reports at the screenshot and skips reports with no capture", () => {
    expect(
      describeScreenAccess({
        attachmentType: "screenshot",
        stepOffsets: [],
        firstProblemOffsets: [],
      })
    ).toMatchObject({ tool: "get_video_frames" })
    expect(
      describeScreenAccess({
        attachmentType: null,
        stepOffsets: [0],
        firstProblemOffsets: [],
      })
    ).toBe(null)
  })
})
