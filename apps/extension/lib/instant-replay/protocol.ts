import { EventType, type eventWithTime } from "@rrweb/types"

// Instant replay, like Jam's: while it is on, every page keeps a DOM session
// replay (rrweb) of its last few minutes in memory. No video is recorded, and
// nothing leaves the browser until the user saves a replay and sends it.

export type ReplayEvent = eventWithTime

export const INSTANT_REPLAY_ENABLED_STORAGE_KEY = "instantReplayEnabled"
// How far back a replay goes. Jam keeps 2 minutes, which is often too short
// to show how a bug came about.
export const INSTANT_REPLAY_WINDOW_MS = 6 * 60_000
// A replay can only start at a full snapshot of the page, taken this often.
export const INSTANT_REPLAY_CHECKOUT_MS = 30_000
export const REPLAY_CONTENT_TYPE = "application/gzip"

export const INSTANT_REPLAY_MESSAGE = {
  // Popup → background: make a report from the replay of a tab.
  save: "crikket:replay:save",
  // Background → page: hand over the buffered replay.
  collect: "crikket:replay:collect",
  // Popup → background: keep a video of a tab or the screen, or stop.
  videoStart: "crikket:replay:video-start",
  videoStop: "crikket:replay:video-stop",
  // Offscreen → background: the captured tab closed or sharing stopped.
  videoEnded: "crikket:replay:video-ended",
} as const

// Where the video comes from: the tab instant replay was turned on in, or
// the whole screen (one share prompt, then every tab).
export type ReplayVideoSource = "tab" | "display"

// In chrome.storage.session: gone after a browser restart or an extension
// reload, like the capture itself.
export const INSTANT_REPLAY_VIDEO_STORAGE_KEY = "instantReplayVideo"

export interface ReplayVideoState {
  source: ReplayVideoSource
  // The recorded tab, for a tab video.
  tabId: number | null
  startedAt: number
}

export interface CollectReplayResponse {
  events?: ReplayEvent[]
  error?: string
}

/**
 * The events for the last keepMs before end. A replay can only start at a
 * full snapshot (which opens with a Meta event), so this starts at the latest
 * one taken at least keepMs before the end, or at the first event.
 */
export function keepLastReplay(
  events: ReplayEvent[],
  keepMs: number,
  end = events.at(-1)?.timestamp ?? 0
): ReplayEvent[] {
  let start = 0
  for (const [index, event] of events.entries()) {
    if (event.timestamp > end - keepMs) break
    if (event.type === EventType.Meta) start = index
  }
  return start === 0 ? events : events.slice(start)
}

/**
 * Marks when the replay was saved, so it lasts until then even when the page
 * was idle: the player ends at the last event.
 */
export function createReplayEndEvent(timestamp: number): ReplayEvent {
  return {
    type: EventType.Custom,
    data: { tag: "crikket-replay-end", payload: {} },
    timestamp,
  }
}

/** Gzipped JSON, the form a replay is uploaded and stored in. */
export async function packReplay(events: ReplayEvent[]): Promise<Blob> {
  const stream = new Blob([JSON.stringify(events)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"))
  return new Blob([await new Response(stream).arrayBuffer()], {
    type: REPLAY_CONTENT_TYPE,
  })
}
