import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Output,
  WebMOutputFormat,
} from "mediabunny"

// Keeps the last few minutes of a tab or screen as encoded video, like a
// dashcam: frames are encoded as they come and old ones dropped, so saving is
// instant and memory stays bounded. Runs in the offscreen document.

// A clip can only start at a key frame, so one is made this often.
const KEY_FRAME_EVERY_US = 2_000_000
const BITRATE = 2_000_000
// Frames waiting for the encoder; more means it cannot keep up, so drop some.
const MAX_QUEUED_FRAMES = 4

interface TrackProcessor {
  readable: ReadableStream<VideoFrame>
}
type TrackProcessorConstructor = new (init: {
  track: MediaStreamTrack
}) => TrackProcessor

export interface VideoClip {
  blob: Blob
  // Wall-clock times of the first and last frame, on the logs' clock.
  startedAt: number
  stoppedAt: number
}

/**
 * Where a clip that covers everything after cutoffUs can start: the newest
 * key frame at or before it (frames after a key frame only describe changes
 * to it), or the first chunk.
 */
export function findClipStart(
  chunks: ReadonlyArray<{ timestamp: number; type: EncodedVideoChunkType }>,
  cutoffUs: number
): number {
  let start = 0
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.timestamp > cutoffUs) break
    if (chunk.type === "key") start = index
  }
  return start
}

export interface VideoReplayBuffer {
  save: () => Promise<VideoClip | null>
  stop: () => void
}

export function createVideoReplayBuffer(
  track: MediaStreamTrack,
  windowMs: number,
  onError: (error: unknown) => void
): VideoReplayBuffer {
  const Processor = (
    globalThis as { MediaStreamTrackProcessor?: TrackProcessorConstructor }
  ).MediaStreamTrackProcessor
  if (!Processor) {
    throw new Error("This browser cannot keep a video replay.")
  }
  const reader = new Processor({ track }).readable.getReader()

  // Chunk timestamps are wall-clock microseconds.
  const chunks: EncodedVideoChunk[] = []
  let decoderConfig: VideoDecoderConfig | undefined
  let encoder: VideoEncoder | null = null
  let size = { width: 0, height: 0 }
  let lastKeyFrameUs = Number.NEGATIVE_INFINITY
  // Encoded again on save: a still page sends no frames, and the clip must
  // last until the moment it was saved.
  let lastFrame: VideoFrame | null = null
  let isStopped = false

  const prune = () => {
    const start = findClipStart(chunks, (Date.now() - windowMs) * 1000)
    if (start > 0) chunks.splice(0, start)
  }

  const createEncoder = () =>
    new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig) {
          decoderConfig = meta.decoderConfig
        }
        chunks.push(chunk)
        if (chunk.type === "key") prune()
      },
      error: onError,
    })

  const encode = (frame: VideoFrame) => {
    encoder ??= createEncoder()
    // A resized window changes the frame size; start the encoder over at
    // the new size with a key frame.
    const isResized =
      frame.displayWidth !== size.width || frame.displayHeight !== size.height
    if (isResized) {
      size = { width: frame.displayWidth, height: frame.displayHeight }
      encoder.configure({
        codec: "vp8",
        ...size,
        bitrate: BITRATE,
        latencyMode: "realtime",
      })
    }
    const keyFrame =
      isResized || frame.timestamp - lastKeyFrameUs >= KEY_FRAME_EVERY_US
    if (keyFrame) lastKeyFrameUs = frame.timestamp
    encoder.encode(frame, { keyFrame })
  }

  const pump = async () => {
    while (!isStopped) {
      const { value: frame, done } = await reader.read()
      if (done) return
      const stamped = new VideoFrame(frame, { timestamp: Date.now() * 1000 })
      frame.close()
      lastFrame?.close()
      lastFrame = stamped.clone()
      if ((encoder?.encodeQueueSize ?? 0) <= MAX_QUEUED_FRAMES) {
        encode(stamped)
      }
      stamped.close()
    }
  }
  pump().catch((error: unknown) => {
    if (!isStopped) onError(error)
  })

  const save = async (): Promise<VideoClip | null> => {
    if (!(encoder && lastFrame)) return null
    const final = new VideoFrame(lastFrame, { timestamp: Date.now() * 1000 })
    encode(final)
    final.close()
    await encoder.flush()
    prune()

    const kept = chunks.slice()
    const first = kept[0]
    const last = kept.at(-1)
    if (!(first && last && decoderConfig)) return null

    const output = new Output({
      format: new WebMOutputFormat(),
      target: new BufferTarget(),
    })
    const source = new EncodedVideoPacketSource("vp8")
    output.addVideoTrack(source)
    await output.start()
    for (const [index, chunk] of kept.entries()) {
      const packet = EncodedPacket.fromEncodedChunk(chunk).clone({
        timestamp: (chunk.timestamp - first.timestamp) / 1_000_000,
      })
      await source.add(packet, index === 0 ? { decoderConfig } : undefined)
    }
    await output.finalize()

    return {
      blob: new Blob([output.target.buffer ?? new ArrayBuffer(0)], {
        type: "video/webm",
      }),
      startedAt: Math.floor(first.timestamp / 1000),
      stoppedAt: Math.floor(last.timestamp / 1000),
    }
  }

  const stop = () => {
    isStopped = true
    reader.cancel().catch(() => undefined)
    track.stop()
    if (encoder && encoder.state !== "closed") encoder.close()
    lastFrame?.close()
    lastFrame = null
    chunks.length = 0
  }

  return { save, stop }
}
