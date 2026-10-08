import type { DebuggerTrimRange } from "@crikket/capture-core/debugger/trim"
import { useCallback, useMemo, useState } from "react"
import { keepLastReplay, type ReplayEvent } from "@/lib/instant-replay/protocol"
import type { StoredReplay } from "@/lib/recording-store"

export interface ReplayCapture {
  replay: StoredReplay | null
  // The part that will be sent, and its place in the replay (for its logs).
  keptEvents: ReplayEvent[] | null
  keptRange: DebuggerTrimRange | null
  // null sends all of it.
  setKeepMs: (keepMs: number | null) => void
  load: (replay: StoredReplay) => void
  reset: () => void
}

/** An instant replay of the page under review, and how much of it to send. */
export function useReplayCapture(): ReplayCapture {
  const [replay, setReplay] = useState<StoredReplay | null>(null)
  const [keepMs, setKeepMs] = useState<number | null>(null)

  const keptEvents = useMemo(() => {
    if (!replay) return null
    return keepMs === null
      ? replay.events
      : keepLastReplay(replay.events, keepMs)
  }, [keepMs, replay])

  const keptRange = useMemo(() => {
    const first = keptEvents?.[0]
    if (!(replay && first)) return null
    return {
      startMs: first.timestamp - replay.startedAt,
      endMs: replay.stoppedAt - replay.startedAt,
    }
  }, [keptEvents, replay])

  const load = useCallback((stored: StoredReplay) => {
    setReplay(stored)
    setKeepMs(null)
  }, [])

  const reset = useCallback(() => {
    setReplay(null)
    setKeepMs(null)
  }, [])

  return { replay, keptEvents, keptRange, setKeepMs, load, reset }
}
