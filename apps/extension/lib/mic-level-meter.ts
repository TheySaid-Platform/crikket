// Reads raw audio frames instead of using Web Audio: Chrome keeps an
// AudioContext suspended on a page nobody clicked (the offscreen recorder),
// which then hears only silence. A copy of the mic track hears while muted.

const QUIET_DB = -60
const LOUD_DB = -10

export interface MicLevelMeter {
  // 0 (silence) to 1 (loud), over the time since the previous read.
  read: () => number
  stop: () => void
}

// The parts of WebCodecs' AudioData and MediaStreamTrackProcessor used here.
interface AudioFrame {
  numberOfFrames: number
  copyTo: (
    destination: Float32Array,
    options: { planeIndex: number; format: "f32-planar" }
  ) => void
  close: () => void
}

type TrackProcessorConstructor = new (init: {
  track: MediaStreamTrack
}) => { readable: ReadableStream<AudioFrame> }

function toLevel(meanSquare: number): number {
  if (meanSquare <= 0) return 0
  // 10 log10(mean square) is the RMS level in decibels.
  const db = 10 * Math.log10(meanSquare)
  return Math.min(1, Math.max(0, (db - QUIET_DB) / (LOUD_DB - QUIET_DB)))
}

function createFrameMeter(
  track: MediaStreamTrack,
  TrackProcessor: TrackProcessorConstructor
): MicLevelMeter {
  const reader = new TrackProcessor({ track }).readable.getReader()
  let sumOfSquares = 0
  let sampleCount = 0
  let samples = new Float32Array(0)

  const measure = (frame: AudioFrame) => {
    try {
      if (samples.length < frame.numberOfFrames) {
        samples = new Float32Array(frame.numberOfFrames)
      }
      const channel = samples.subarray(0, frame.numberOfFrames)
      frame.copyTo(channel, { planeIndex: 0, format: "f32-planar" })
      for (const sample of channel) {
        sumOfSquares += sample * sample
      }
      sampleCount += channel.length
    } finally {
      frame.close()
    }
  }

  const pump = async () => {
    let result = await reader.read()
    while (!(result.done || result.value === undefined)) {
      measure(result.value)
      result = await reader.read()
    }
  }
  pump().catch(() => undefined)

  return {
    read: () => {
      const level = sampleCount > 0 ? toLevel(sumOfSquares / sampleCount) : 0
      sumOfSquares = 0
      sampleCount = 0
      return level
    },
    stop: () => {
      reader.cancel().catch(() => undefined)
      track.stop()
    },
  }
}

// For browsers without MediaStreamTrackProcessor. It only hears the mic once
// the page may play audio.
function createAnalyserMeter(track: MediaStreamTrack): MicLevelMeter {
  const context = new AudioContext()
  context.resume().catch(() => undefined)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  context.createMediaStreamSource(new MediaStream([track])).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)

  return {
    read: () => {
      analyser.getFloatTimeDomainData(samples)
      let sumOfSquares = 0
      for (const sample of samples) {
        sumOfSquares += sample * sample
      }
      return toLevel(sumOfSquares / samples.length)
    },
    stop: () => {
      track.stop()
      context.close().catch(() => undefined)
    },
  }
}

export function createMicLevelMeter(micTrack: MediaStreamTrack): MicLevelMeter {
  const track = micTrack.clone()
  track.enabled = true

  const TrackProcessor = (
    globalThis as { MediaStreamTrackProcessor?: TrackProcessorConstructor }
  ).MediaStreamTrackProcessor
  return TrackProcessor
    ? createFrameMeter(track, TrackProcessor)
    : createAnalyserMeter(track)
}
