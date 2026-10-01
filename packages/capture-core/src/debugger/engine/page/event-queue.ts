import {
  FLUSH_INTERVAL_MS,
  MAX_BATCH_SIZE,
  PAGE_EVENTS_EVENT,
  PAGE_SOURCE,
} from "./constants"
import type { EventQueue } from "./types"

interface EventQueueDiagnostics {
  recordQueuedEvent?: () => void
  recordFlushedBatch?: () => void
}

export function createEventQueue(
  input: EventQueueDiagnostics = {}
): EventQueue {
  const { recordFlushedBatch, recordQueuedEvent } = input
  const eventQueue: unknown[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  const flushEventQueue = () => {
    flushTimer = null

    if (eventQueue.length === 0) {
      return
    }

    // Everything goes out now, in batches, because this also runs while the
    // page unloads and a later timer would never fire.
    while (eventQueue.length > 0) {
      const batchedEvents = eventQueue.splice(0, MAX_BATCH_SIZE)
      recordFlushedBatch?.()

      try {
        // A string detail is readable from the extension's isolated world.
        window.dispatchEvent(
          new CustomEvent(PAGE_EVENTS_EVENT, {
            detail: JSON.stringify({
              source: PAGE_SOURCE,
              events: batchedEvents,
            }),
          })
        )
      } catch {
        // An event that cannot be serialized is dropped, not the page.
      }
    }
  }

  const scheduleEventFlush = () => {
    if (flushTimer) {
      return
    }

    flushTimer = setTimeout(flushEventQueue, FLUSH_INTERVAL_MS)
  }

  const enqueueEvent = (event: unknown) => {
    eventQueue.push(event)
    recordQueuedEvent?.()

    if (eventQueue.length >= MAX_BATCH_SIZE) {
      if (flushTimer) {
        clearTimeout(flushTimer)
      }

      flushTimer = setTimeout(flushEventQueue, 0)
      return
    }

    scheduleEventFlush()
  }

  return {
    enqueueEvent,
    flushEventQueue,
  }
}
