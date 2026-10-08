"use client"

import "rrweb-player/dist/style.css"
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import type Player from "rrweb-player"

export type ReplayEvents = ConstructorParameters<
  typeof Player
>[0]["props"]["events"]

/**
 * What a timeline needs from a player. An HTMLVideoElement has all of it, so
 * a video and a session replay can drive the same timeline.
 */
export interface PlaybackHandle {
  currentTime: number
  readonly paused: boolean
  play: () => Promise<void>
  readonly offsetParent: Element | null
}

interface ReplayPlayerProps {
  events: ReplayEvents
  // The replay keeps the page's shape; this caps its height.
  maxHeight?: number
  // Playback position in ms, a few times a second.
  onTimeUpdate?: (timeMs: number) => void
  className?: string
}

// rrweb-player is a Svelte component. Its typings need svelte, which is not
// installed, so the component methods are typed here.
interface SvelteComponentMethods {
  $set: (props: Record<string, unknown>) => void
  $destroy: () => void
}

// rrweb-player's controls, below the replay.
const CONTROLLER_HEIGHT = 80
const TIME_UPDATE_STEP_MS = 250
const META_EVENT_TYPE = 4

function getViewportRatio(events: ReplayEvents): number {
  const meta = events.find((event) => event.type === META_EVENT_TYPE)
  const { width, height } = (meta?.data ?? {}) as {
    width?: number
    height?: number
  }
  return width && height ? height / width : 9 / 16
}

/**
 * Plays a DOM session replay (rrweb) of an instant replay, with
 * rrweb-player's own controls.
 */
export const ReplayPlayer = forwardRef<PlaybackHandle, ReplayPlayerProps>(
  ({ events, maxHeight = 560, onTimeUpdate, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const playerRef = useRef<Player | null>(null)
    const playbackRef = useRef({ timeMs: 0, paused: true })
    const onTimeUpdateRef = useRef(onTimeUpdate)

    useEffect(() => {
      onTimeUpdateRef.current = onTimeUpdate
    }, [onTimeUpdate])

    useEffect(() => {
      const container = containerRef.current
      if (!container || events.length < 2) return

      const ratio = getViewportRatio(events)
      const getSize = () => {
        const width = container.clientWidth
        return { width, height: Math.min(width * ratio, maxHeight) }
      }

      let player: (Player & SvelteComponentMethods) | null = null
      let isCancelled = false
      let lastReportedMs = Number.NEGATIVE_INFINITY
      // Loaded on demand: it needs the DOM, and only replays use it.
      import("rrweb-player").then(({ default: RrwebPlayer }) => {
        if (isCancelled) return
        player = new RrwebPlayer({
          target: container,
          props: { events, ...getSize(), autoPlay: false, skipInactive: true },
        }) as Player & SvelteComponentMethods
        player.addEventListener("ui-update-current-time", (detail) => {
          const timeMs = (detail as { payload: number }).payload
          playbackRef.current.timeMs = timeMs
          if (Math.abs(timeMs - lastReportedMs) >= TIME_UPDATE_STEP_MS) {
            lastReportedMs = timeMs
            onTimeUpdateRef.current?.(timeMs)
          }
        })
        player.addEventListener("ui-update-player-state", (detail) => {
          playbackRef.current.paused =
            (detail as { payload: string }).payload !== "playing"
        })
        playerRef.current = player
      })

      const resizeObserver = new ResizeObserver(() => {
        player?.$set(getSize())
        player?.triggerResize()
      })
      resizeObserver.observe(container)

      return () => {
        isCancelled = true
        resizeObserver.disconnect()
        player?.$destroy()
        playerRef.current = null
        playbackRef.current = { timeMs: 0, paused: true }
        container.replaceChildren()
      }
    }, [events, maxHeight])

    useImperativeHandle(
      ref,
      () => ({
        get currentTime() {
          return playbackRef.current.timeMs / 1000
        },
        set currentTime(seconds: number) {
          playbackRef.current.timeMs = seconds * 1000
          playerRef.current?.goto(seconds * 1000, !playbackRef.current.paused)
        },
        get paused() {
          return playbackRef.current.paused
        },
        play: () => {
          playerRef.current?.play()
          return Promise.resolve()
        },
        get offsetParent() {
          return containerRef.current?.offsetParent ?? null
        },
      }),
      []
    )

    return (
      <div
        className={className}
        ref={containerRef}
        style={{ minHeight: CONTROLLER_HEIGHT }}
      />
    )
  }
)

ReplayPlayer.displayName = "ReplayPlayer"
