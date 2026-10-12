import { describe, expect, it } from "bun:test"

import { createGate, MediaBusyError } from "../src/media/gate"
import {
  describeTarget,
  resolveFrameTarget,
  STEP_FRAME_DELAY_MS,
} from "../src/media/targets"
import {
  buildNetworkRequestFilter,
  parseStatusFilter,
} from "../src/network-filters"
import {
  countNotStored,
  describeScreenAccess,
  firstErrorPerTab,
} from "../src/tools/get-bug-context"
import { makeEvents, makeRequests } from "./fixtures"

const STEPS = [0, 4000, null, 12_500]

function offsetOf(value: string | number): number | null {
  const result = resolveFrameTarget(value, STEPS)
  return result.ok ? result.target.offsetMs : null
}

describe("resolveFrameTarget", () => {
  it("reads clock times and seconds, and bare numbers as milliseconds", () => {
    expect(offsetOf("1:05")).toBe(65_000)
    expect(offsetOf("1:05.3")).toBe(65_300)
    expect(offsetOf("1:02:03")).toBe(3_723_000)
    expect(offsetOf("45s")).toBe(45_000)
    expect(offsetOf("12.5s")).toBe(12_500)
    expect(offsetOf("1500ms")).toBe(1500)
    // Bare numbers are milliseconds, like offsetMs in every tool result.
    expect(offsetOf(45_000)).toBe(45_000)
    expect(offsetOf("45000")).toBe(45_000)
    expect(offsetOf(0)).toBe(0)
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

describe("network filters", () => {
  const requests = makeRequests({ total: 6, failEvery: 2 }).map(
    (request, index) => ({
      ...request,
      status: [500, 200, 404, 200, 0, 302][index] ?? 200,
      url:
        [
          "https://api.example.com/a",
          "https://example.com/b",
          "https://cdn.other.io/c",
          "https://api.example.com/d",
          "https://api.example.com/e",
          "https://example.com/f",
        ][index] ?? "",
      responseHeaders: {
        "Content-Type": index % 2 === 0 ? "application/json" : "text/html",
      },
    })
  )
  const ids = (filter: (request: (typeof requests)[number]) => boolean) =>
    requests.filter(filter).map((request) => request.id)

  it("parses status classes and codes, and rejects anything else", () => {
    const status = parseStatusFilter(["5xx", "404"])
    expect(status.ok).toBe(true)
    if (status.ok) {
      expect([500, 503, 404, 400, 200, null].map(status.matches)).toEqual([
        true,
        true,
        true,
        false,
        false,
        false,
      ])
    }
    expect(parseStatusFilter(["5xx", "fivehundred"])).toEqual({
      ok: false,
      invalid: ["fivehundred"],
    })
  })

  it("combines filters with AND and values with OR", () => {
    const status = parseStatusFilter(["4xx", "5xx"])
    if (!status.ok) {
      throw new Error("bad status filter")
    }
    expect(ids(buildNetworkRequestFilter({}, status.matches))).toEqual([
      "req_0",
      "req_2",
    ])
    expect(
      ids(buildNetworkRequestFilter({ hosts: ["example.com"] }, null))
    ).toEqual(["req_0", "req_1", "req_3", "req_4", "req_5"])
    expect(
      ids(
        buildNetworkRequestFilter(
          { hosts: ["api.example.com"], methods: ["post"] },
          null
        )
      )
    ).toEqual(["req_0", "req_4"])
    expect(
      ids(
        buildNetworkRequestFilter(
          { contentTypes: ["json"], failedOnly: true },
          null
        )
      )
    ).toEqual(["req_0", "req_2", "req_4"])
  })
})

describe("bug context helpers", () => {
  it("picks the first error of each tab", () => {
    const { logs } = makeEvents({ errors: 4, warnings: 1 })
    const tabbed = logs.map((log, index) => ({
      ...log,
      tabId: [11, 11, 12, 12, 13][index] ?? 11,
    }))
    expect(firstErrorPerTab(tabbed).map((log) => log.id)).toEqual([
      "log_0",
      "log_2",
    ])
  })

  it("reports items the recorder captured but ingestion did not store", () => {
    const metadata = {
      debuggerSummary: { actions: 10, logs: 2500, networkRequests: 40 },
    }
    expect(
      countNotStored(metadata, { actions: 10, logs: 2000, networkRequests: 38 })
    ).toEqual({ logs: 500, networkRequests: 2 })
    expect(
      countNotStored(metadata, { actions: 10, logs: 2500, networkRequests: 40 })
    ).toBe(null)
    expect(
      countNotStored({}, { actions: 0, logs: 0, networkRequests: 0 })
    ).toBe(null)
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
