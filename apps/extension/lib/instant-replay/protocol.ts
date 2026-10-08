import { EventType, type eventWithTime } from "@rrweb/types"

// Instant replay: while it is on, every page keeps a DOM session replay
// (rrweb) of its last few minutes in memory, and the worker keeps what earlier
// pages of the tab recorded. Nothing leaves the browser until the user shares
// a replay and sends the report.

export type ReplayEvent = eventWithTime

export const INSTANT_REPLAY_ENABLED_STORAGE_KEY = "instantReplayEnabled"
// How far back a replay goes: long enough to show how a bug came about.
export const INSTANT_REPLAY_WINDOW_MS = 6 * 60_000
// A replay can only start at a full snapshot of the page, taken this often.
export const INSTANT_REPLAY_CHECKOUT_MS = 30_000
export const REPLAY_CONTENT_TYPE = "application/gzip"

export const INSTANT_REPLAY_MESSAGE = {
  // Popup → background: make a report from the replay of a tab.
  save: "crikket:replay:save",
  // Background → page: hand over the buffered replay.
  collect: "crikket:replay:collect",
  // Page → background: the page is going away (reload, navigation); here is
  // what it recorded.
  pageLeft: "crikket:replay:page-left",
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

// DOM events between the recorder in the page's own world and the bridge in
// the extension's world. Details are strings, the only kind that crosses.
export const REPLAY_PAGE_EVENT = {
  // Bridge → recorder: detail "peek" (collect) or "take" (the page leaves,
  // so the recorder hands its events over and starts afresh).
  request: "crikket:replay:request",
  // Recorder → bridge: detail is a JSON CollectReplayResponse.
  response: "crikket:replay:response",
  start: "crikket:replay:start",
  stop: "crikket:replay:stop",
  // Back from the back/forward cache: start a new segment.
  snapshot: "crikket:replay:snapshot",
} as const

/**
 * The events for the last keepMs before end. A replay can only start at a
 * full snapshot (which opens with a Meta event), so this starts at the latest
 * one taken at least keepMs before the end, or at the first event. What
 * happened between that snapshot and the cut only rebuilds the page as it was
 * at the cut, so it plays at the cut: the replay lasts exactly keepMs, even
 * when the page sat still and took no snapshot for a long time.
 */
export function keepLastReplay(
  events: ReplayEvent[],
  keepMs: number,
  end = events.at(-1)?.timestamp ?? 0
): ReplayEvent[] {
  const cut = end - keepMs
  let start = 0
  for (const [index, event] of events.entries()) {
    if (event.timestamp > cut) break
    if (event.type === EventType.Meta) start = index
  }
  const kept = start === 0 ? events : events.slice(start)
  if ((kept[0]?.timestamp ?? cut) >= cut) return kept
  return kept.map((event) =>
    event.timestamp < cut ? { ...event, timestamp: cut } : event
  )
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
