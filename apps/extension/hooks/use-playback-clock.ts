import { type RefObject, useEffect, useRef } from "react"

/**
 * While the video plays, reports its time on every animation frame, so the
 * playhead and drawings move smoothly (timeupdate only fires about 4 times a
 * second).
 */
export function usePlaybackClock(
  videoRef: RefObject<HTMLVideoElement | null>,
  isPlaying: boolean,
  onTime: (ms: number) => void
): void {
  const onTimeRef = useRef(onTime)
  onTimeRef.current = onTime

  useEffect(() => {
    if (!isPlaying) return
    let frame = 0
    const tick = () => {
      const video = videoRef.current
      if (video) onTimeRef.current(video.currentTime * 1000)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, videoRef])
}
