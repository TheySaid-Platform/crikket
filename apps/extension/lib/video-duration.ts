// MediaRecorder files store no length, so Chrome reports Infinity and cannot
// seek. Seeking far past the end makes it scan the file once.
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
