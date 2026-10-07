import { describe, expect, it } from "bun:test"
import { EventType } from "@rrweb/types"
import {
  createReplayEndEvent,
  keepLastReplay,
  packReplay,
  type ReplayEvent,
} from "./protocol"

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

  it("starts at the newest full snapshot at least keepMs before the end", () => {
    const kept = keepLastReplay(replay, 30_000)
    expect(kept[0].type).toBe(EventType.Meta)
    expect(kept[0].timestamp).toBe(60_000)
    expect(kept.at(-1)?.timestamp).toBe(100_000)
  })

  it("keeps everything when keepMs reaches past the first snapshot", () => {
    expect(keepLastReplay(replay, 500_000)).toBe(replay)
  })

  it("measures from the given end, for a page that went still", () => {
    const kept = keepLastReplay(replay, 60_000, 160_000)
    expect(kept[0].timestamp).toBe(90_000)
  })

  it("never starts between snapshots", () => {
    for (const keepMs of [1000, 15_000, 45_000, 75_000]) {
      expect(keepLastReplay(replay, keepMs)[0].type).toBe(EventType.Meta)
    }
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
