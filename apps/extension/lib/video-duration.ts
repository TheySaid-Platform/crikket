/**
 * MediaRecorder files do not store their length, so Chrome reports an
 * infinite duration and refuses to seek in them. Jumping far past the end
 * makes Chrome scan the file once and learn the real length. Calls onReady
 * once seeking works.
 */
export function primeVideoDuration(
  video: HTMLVideoElement,
  onReady: () => void
): void {
  if (Number.isFinite(video.duration)) {
    onReady()
    return
  }

  const handleDurationChange = () => {
    if (!Number.isFinite(video.duration)) return
    video.removeEventListener("durationchange", handleDurationChange)
    onReady()
  }
  video.addEventListener("durationchange", handleDurationChange)
  video.currentTime = Number.MAX_SAFE_INTEGER
}
