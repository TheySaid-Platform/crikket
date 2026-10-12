import { Button } from "@crikket/ui/components/ui/button"
import { EyeOff, X } from "lucide-react"
import { getToolIcon, getToolLabel } from "@/components/annotation-toolbar"
import { formatDuration } from "@/lib/utils"
import type { BlurRegion, VideoDrawing } from "@/lib/video-edit"

const SHOW_FOR_OPTIONS_MS = [1000, 2000, 3000, 5000, 10_000]
const UNTIL_END = "end"

interface VideoEditListProps {
  drawings: VideoDrawing[]
  blurRegions: BlurRegion[]
  durationMs: number
  // Start of the kept part, so times match the final clip.
  clipStartMs: number
  onSeek: (ms: number) => void
  onShowForChange: (id: string, endMs: number) => void
  onRemoveDrawing: (id: string) => void
  onRemoveBlur: (id: string) => void
}

function describeDrawing(drawing: VideoDrawing): string {
  const { annotation } = drawing
  if (annotation.kind === "text") return `"${annotation.text}"`
  return getToolLabel(annotation.kind)
}

function getShowForValue(drawing: VideoDrawing, durationMs: number): string {
  if (drawing.endMs >= durationMs) return UNTIL_END
  return String(drawing.endMs - drawing.startMs)
}

/** What has been added to the video: drawings with their timing, and blurs. */
export function VideoEditList({
  drawings,
  blurRegions,
  durationMs,
  clipStartMs,
  onSeek,
  onShowForChange,
  onRemoveDrawing,
  onRemoveBlur,
}: VideoEditListProps) {
  if (drawings.length === 0 && blurRegions.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-4 text-center text-muted-foreground text-sm">
        Move to the moment that shows the bug, then draw on the video. Each
        drawing shows for 3 seconds; you can change that here afterwards. Blur
        hides an area for the whole clip.
      </p>
    )
  }

  const clipTime = (ms: number) => formatDuration(Math.max(0, ms - clipStartMs))

  return (
    <ul className="divide-y overflow-hidden rounded-xl border">
      {drawings.map((drawing) => {
        const Icon = getToolIcon(drawing.annotation.kind)
        const color =
          drawing.annotation.kind === "blur"
            ? "#64748b"
            : drawing.annotation.color
        const showFor = getShowForValue(drawing, durationMs)
        const options = SHOW_FOR_OPTIONS_MS.map(String)
        if (showFor !== UNTIL_END && !options.includes(showFor)) {
          options.push(showFor)
        }

        return (
          <li className="flex items-center gap-3 px-3 py-2" key={drawing.id}>
            <button
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
              onClick={() => onSeek(drawing.startMs)}
              title="Jump to this drawing"
              type="button"
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${color}22`, color }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-sm">
                {describeDrawing(drawing)}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
                {clipTime(drawing.startMs)}
              </span>
            </button>
            <select
              aria-label="How long it shows"
              className="h-8 rounded-md border bg-background px-2 text-xs"
              onChange={(event) => {
                const { value } = event.target
                onShowForChange(
                  drawing.id,
                  value === UNTIL_END
                    ? durationMs
                    : Math.min(durationMs, drawing.startMs + Number(value))
                )
              }}
              value={showFor}
            >
              {options.map((value) => (
                <option key={value} value={value}>
                  {`Shows ${Math.round(Number(value) / 100) / 10}s`}
                </option>
              ))}
              <option value={UNTIL_END}>Until the end</option>
            </select>
            <Button
              aria-label="Remove drawing"
              onClick={() => onRemoveDrawing(drawing.id)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          </li>
        )
      })}

      {blurRegions.map((region, index) => (
        <li className="flex items-center gap-3 px-3 py-2" key={region.id}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <EyeOff className="h-4 w-4" />
          </span>
          <span className="flex-1 font-medium text-sm">
            Blur area {index + 1}
          </span>
          <span className="text-muted-foreground text-xs">Whole clip</span>
          <Button
            aria-label="Remove blur"
            onClick={() => onRemoveBlur(region.id)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        </li>
      ))}
    </ul>
  )
}
