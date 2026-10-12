import { describe, expect, it } from "bun:test"
import { gzipSync } from "node:zlib"
import {
  assertReplayUploadSize,
  MAX_REPLAY_BYTES,
  readReplayFile,
} from "../src/lib/replay"

const stored = gzipSync(JSON.stringify([{ type: 4, timestamp: 1 }]))

function createStorage(size: number | null) {
  const calls = { read: 0 }
  return {
    calls,
    storage: {
      size: () => Promise.resolve(size),
      read: () => {
        calls.read += 1
        return Promise.resolve(stored)
      },
    },
  }
}

const replayReport = { attachmentType: "replay", captureKey: "replay.json.gz" }

describe("readReplayFile", () => {
  it("returns the stored gzip as it is", async () => {
    const { storage } = createStorage(stored.length)
    const file = await readReplayFile(replayReport, storage)

    expect(file.type).toBe("application/gzip")
    expect(Buffer.from(await file.arrayBuffer())).toEqual(stored)
  })

  it("refuses reports that are not replays", async () => {
    const { storage, calls } = createStorage(stored.length)
    for (const report of [
      null,
      { attachmentType: "video", captureKey: "video.webm" },
      { attachmentType: "replay", captureKey: null },
    ]) {
      await expect(readReplayFile(report, storage)).rejects.toMatchObject({
        code: "NOT_FOUND",
      })
    }
    expect(calls.read).toBe(0)
  })

  it("refuses a replay missing from storage", async () => {
    const { storage } = createStorage(null)
    await expect(readReplayFile(replayReport, storage)).rejects.toMatchObject({
      code: "NOT_FOUND",
    })
  })

  it("refuses a replay too large to read, without reading it", async () => {
    const { storage, calls } = createStorage(MAX_REPLAY_BYTES + 1)
    await expect(readReplayFile(replayReport, storage)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    })
    expect(calls.read).toBe(0)
  })
})

describe("assertReplayUploadSize", () => {
  const upload = { attachmentType: "replay", captureKey: "replay.json.gz" }

  it("accepts a replay up to the limit, and other captures", async () => {
    await expect(
      assertReplayUploadSize(upload, createStorage(MAX_REPLAY_BYTES).storage)
    ).resolves.toBeUndefined()
    await expect(
      assertReplayUploadSize(
        { attachmentType: "video", captureKey: "video.webm" },
        createStorage(MAX_REPLAY_BYTES + 1).storage
      )
    ).resolves.toBeUndefined()
  })

  it("refuses an uploaded replay that could never be shown", async () => {
    await expect(
      assertReplayUploadSize(
        upload,
        createStorage(MAX_REPLAY_BYTES + 1).storage
      )
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" })
  })
})
