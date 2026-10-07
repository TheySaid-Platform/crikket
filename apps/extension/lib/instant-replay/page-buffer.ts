import { record } from "@rrweb/record"
import { EventType } from "@rrweb/types"
import {
  type CollectReplayResponse,
  createReplayEndEvent,
  INSTANT_REPLAY_CHECKOUT_MS,
  INSTANT_REPLAY_ENABLED_STORAGE_KEY,
  INSTANT_REPLAY_MESSAGE,
  INSTANT_REPLAY_WINDOW_MS,
  keepLastReplay,
  type ReplayEvent,
} from "./protocol"

// A page that changes this much within the window (live tickers,
// spreadsheets) would get slow, so instant replay leaves it alone, as Jam does.
const MAX_BUFFERED_EVENTS = 100_000
const TOO_BUSY_ERROR =
  "This page changes too often for instant replay. Record it instead."

/**
 * Runs on every page. While instant replay is on, it records the page with
 * rrweb and keeps the last few minutes, ready for the background to collect.
 */
export function startInstantReplayBuffer(): void {
  let events: ReplayEvent[] = []
  let stopRecording: (() => void) | undefined
  let isTooBusy = false

  const turnOff = () => {
    stopRecording?.()
    stopRecording = undefined
    events = []
  }

  const onEvent = (event: ReplayEvent) => {
    // An extension reload leaves this copy behind, with no way to hand over
    // what it records.
    if (!chrome.runtime?.id) {
      turnOff()
      return
    }
    // Each full snapshot is a new place a replay can start; drop the ones
    // too old to be needed.
    if (event.type === EventType.Meta) {
      events = keepLastReplay(events, INSTANT_REPLAY_WINDOW_MS, event.timestamp)
    }
    events.push(event)
    if (events.length > MAX_BUFFERED_EVENTS) {
      isTooBusy = true
      turnOff()
    }
  }

  const turnOn = () => {
    if (stopRecording || isTooBusy) return
    stopRecording = record({
      emit: onEvent,
      checkoutEveryNms: INSTANT_REPLAY_CHECKOUT_MS,
      // Crikket's own review is not part of the page.
      blockSelector: "#crikket-review-overlay",
    })
  }

  const apply = (isEnabled: unknown) => {
    if (isEnabled === true) {
      turnOn()
    } else {
      turnOff()
    }
  }

  chrome.storage.local
    .get(INSTANT_REPLAY_ENABLED_STORAGE_KEY)
    .then((result) => apply(result[INSTANT_REPLAY_ENABLED_STORAGE_KEY]))
    .catch(() => undefined)

  chrome.storage.onChanged.addListener((changes, areaName) => {
    const change = changes[INSTANT_REPLAY_ENABLED_STORAGE_KEY]
    if (areaName === "local" && change) {
      apply(change.newValue)
    }
  })

  chrome.runtime.onMessage.addListener(
    (message: { type?: unknown }, _sender, sendResponse) => {
      if (message?.type !== INSTANT_REPLAY_MESSAGE.collect) return

      if (isTooBusy) {
        sendResponse({ error: TOO_BUSY_ERROR } satisfies CollectReplayResponse)
        return
      }
      const now = Date.now()
      const kept = keepLastReplay(events, INSTANT_REPLAY_WINDOW_MS, now)
      sendResponse({
        events: kept.length > 0 ? [...kept, createReplayEndEvent(now)] : [],
      } satisfies CollectReplayResponse)
    }
  )
}
