export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms))
  })

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Get device info for the current browser
 */
export function getDeviceInfo() {
  return {
    browser: navigator.userAgent,
    os: navigator.platform,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
  }
}

/**
 * Format duration in milliseconds to MM:SS
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
}
