import { describe, expect, it } from "bun:test"
import { EventType } from "@rrweb/types"
import {
  createReplayEndEvent,
  keepLastReplay,
  packReplay,
  type ReplayEvent,
} from "./protocol"
import { findClipStart } from "./video-buffer"

// A full snapshot (Meta + FullSnapshot) at each of `snapshotsAt`, with a
// mouse move every second in between.
function buildReplay(snapshotsAt: number[], endAt: number): ReplayEvent[] {
  const events: ReplayEvent[] = []
  for (let time = snapshotsAt[0]; time <= endAt; time += 1000) {
    if (snapshotsAt.includes(time)) {
      events.push({
        type: EventType.Meta,
        data: { href: "https://example.com", width: 1280, height: 720 },
        timestamp: time,
      })
      events.push({
        type: EventType.FullSnapshot,
        data: {
          node: { type: 0, childNodes: [], id: 1 },
          initialOffset: { top: 0, left: 0 },
        },
        timestamp: time,
      } as ReplayEvent)
    } else {
      events.push({
        type: EventType.IncrementalSnapshot,
        data: { source: 1, positions: [] },
        timestamp: time,
      } as ReplayEvent)
    }
  }
  return events
}

describe("keepLastReplay", () => {
  const replay = buildReplay([0, 30_000, 60_000, 90_000], 100_000)

  it("starts at the newest full snapshot before the cut, played at the cut", () => {
    const kept = keepLastReplay(replay, 30_000)
    expect(kept[0].type).toBe(EventType.Meta)
    expect(kept[1].type).toBe(EventType.FullSnapshot)
    // The snapshot from 60 s and the changes up to 70 s rebuild the page as
    // it was at 70 s, the cut.
    expect(kept[0].timestamp).toBe(70_000)
    expect(kept.filter((event) => event.timestamp === 70_000)).toHaveLength(12)
    expect(kept[12].timestamp).toBe(71_000)
    expect(kept.at(-1)?.timestamp).toBe(100_000)
  })

  it("keeps everything when keepMs reaches past the first snapshot", () => {
    expect(keepLastReplay(replay, 500_000)).toBe(replay)
  })

  it("lasts exactly keepMs on a page that sat still", () => {
    // Nothing happened after 100 s, so the last snapshot is from 90 s.
    const kept = keepLastReplay(replay, 60_000, 460_000)
    expect(kept[0].type).toBe(EventType.Meta)
    expect(kept[0].timestamp).toBe(400_000)
    expect(kept.every((event) => event.timestamp >= 400_000)).toBe(true)
  })

  it("never starts between snapshots", () => {
    for (const keepMs of [1000, 15_000, 45_000, 75_000]) {
      expect(keepLastReplay(replay, keepMs)[0].type).toBe(EventType.Meta)
    }
  })
})

describe("findClipStart", () => {
  const chunks = [0, 1, 2, 3, 4, 5, 6].map((second) => ({
    timestamp: second * 1_000_000,
    type: (second % 2 === 0 ? "key" : "delta") as EncodedVideoChunkType,
  }))

  it("starts at the newest key frame at or before the cutoff", () => {
    expect(findClipStart(chunks, 3_500_000)).toBe(2)
    expect(findClipStart(chunks, 4_000_000)).toBe(4)
  })

  it("starts at the first chunk when the buffer is shorter than the window", () => {
    expect(findClipStart(chunks, -5_000_000)).toBe(0)
  })
})

describe("packReplay", () => {
  it("gzips the events as JSON", async () => {
    const events = [...buildReplay([0], 2000), createReplayEndEvent(3000)]
    const blob = await packReplay(events)
    expect(blob.type).toBe("application/gzip")

    const text = await new Response(
      blob.stream().pipeThrough(new DecompressionStream("gzip"))
    ).text()
    expect(JSON.parse(text)).toEqual(events)
  })
})
