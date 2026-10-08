import { record } from "@rrweb/record"
import { EventType } from "@rrweb/types"
import {
  type CollectReplayResponse,
  INSTANT_REPLAY_CHECKOUT_MS,
  INSTANT_REPLAY_WINDOW_MS,
  keepLastReplay,
  REPLAY_PAGE_EVENT,
  type ReplayEvent,
} from "./protocol"

// A page that changes this much within the window (live tickers,
// spreadsheets) would get slow, so instant replay leaves it alone.
const MAX_BUFFERED_EVENTS = 100_000
const TOO_BUSY_ERROR =
  "This page changes too often for instant replay. Record it instead."
const INSTALL_FLAG = "__crikketReplayRecorder"

/**
 * Records the page with rrweb and keeps the last few minutes. Runs in the
 * page's own JavaScript world: rrweb patches CSSStyleSheet.insertRule and the
 * input value setters, and from the extension's isolated world it would not
 * see the page's own calls (CSS-in-JS styles, values set by script).
 */
export function startReplayRecorder(): void {
  const scope = window as Window & { [INSTALL_FLAG]?: boolean }
  // Injected again after being turned off and on: start the running copy.
  if (scope[INSTALL_FLAG]) {
    document.dispatchEvent(new CustomEvent(REPLAY_PAGE_EVENT.start))
    return
  }
  scope[INSTALL_FLAG] = true

  let events: ReplayEvent[] = []
  let stopRecording: (() => void) | undefined
  let isTooBusy = false

  const turnOff = () => {
    stopRecording?.()
    stopRecording = undefined
    events = []
  }

  const onEvent = (event: ReplayEvent) => {
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
      // What people type is never recorded, only how long it is (as in the
      // action log). Hidden inputs hold tokens; [data-private] lets an app
      // hide more.
      maskAllInputs: true,
      maskTextSelector: "[data-private]",
      blockSelector:
        '#crikket-review-overlay, [data-private], input[type="hidden"]',
    })
  }

  const respond = (take: boolean) => {
    const response: CollectReplayResponse = isTooBusy
      ? { error: TOO_BUSY_ERROR }
      : {
          events: keepLastReplay(events, INSTANT_REPLAY_WINDOW_MS, Date.now()),
        }
    if (take) events = []
    document.dispatchEvent(
      new CustomEvent(REPLAY_PAGE_EVENT.response, {
        detail: JSON.stringify(response),
      })
    )
  }

  document.addEventListener(REPLAY_PAGE_EVENT.request, (event) => {
    respond((event as CustomEvent<unknown>).detail === "take")
  })
  document.addEventListener(REPLAY_PAGE_EVENT.start, turnOn)
  document.addEventListener(REPLAY_PAGE_EVENT.stop, turnOff)
  document.addEventListener(REPLAY_PAGE_EVENT.snapshot, () => {
    if (stopRecording) record.takeFullSnapshot(true)
  })

  turnOn()
}
