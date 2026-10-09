import type { BlurRegion } from "@/lib/video-edit"

// Previews a blurred area over the video. The real blur is applied to every
// frame when the report is submitted.
export function BlurRegionBox({
  region,
  isDraft = false,
}: {
  region: Omit<BlurRegion, "id">
  isDraft?: boolean
}) {
  return (
    <div
      className={
        isDraft
          ? "absolute border-2 border-white border-dashed bg-white/10"
          : "absolute border-2 border-white/80 backdrop-blur-md"
      }
      style={{
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.width * 100}%`,
        height: `${region.height * 100}%`,
      }}
    />
  )
}
