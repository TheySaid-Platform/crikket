import { describe, expect, it } from "bun:test"
import { gzipSync } from "node:zlib"
import { readReplayFile } from "./read-replay-file"

const events = [{ type: 4, data: {}, timestamp: 1 }]

describe("readReplayFile", () => {
  it("unpacks a gzipped replay", async () => {
    const file = new Blob([gzipSync(JSON.stringify(events))])
    expect(await readReplayFile(file)).toEqual(events)
  })

  it("reads a replay that was stored unpacked", async () => {
    const file = new Blob([JSON.stringify(events)])
    expect(await readReplayFile(file)).toEqual(events)
  })

  it("stops reading a replay that unpacks past the limit", async () => {
    // 1 MB of zeros packs to about 1 KB.
    const file = new Blob([gzipSync(Buffer.alloc(1024 * 1024))])
    expect(file.size).toBeLessThan(10 * 1024)
    await expect(readReplayFile(file, 64 * 1024)).rejects.toThrow(
      "too large to show"
    )
  })
})
