"use client"

import {
  type PlaybackHandle,
  type ReplayEvents,
  ReplayPlayer,
} from "@crikket/ui/components/replay-player"
import { useIsMobile } from "@crikket/ui/hooks/use-mobile"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { forwardRef } from "react"
import { client } from "@/utils/orpc"

interface ReplayAttachmentProps {
  reportId: string
  // The narrow-screen copy of the canvas.
  compact: boolean
  onTimeUpdate?: (currentTimeMs: number) => void
}

// The server sends the replay as it was stored (gzipped JSON), and the
// browser unpacks it.
async function loadReplayEvents(reportId: string): Promise<ReplayEvents> {
  const file = await client.bugReport.getReplay({ id: reportId })
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const isGzip = head[0] === 0x1f && head[1] === 0x8b
  const stream = isGzip
    ? file.stream().pipeThrough(new DecompressionStream("gzip"))
    : file.stream()
  return JSON.parse(await new Response(stream).text()) as ReplayEvents
}

/** An instant replay: the page rebuilt from its recorded changes. */
export const ReplayAttachment = forwardRef<
  PlaybackHandle,
  ReplayAttachmentProps
>(({ reportId, compact, onTimeUpdate }, ref) => {
  // The page lays the canvas out twice, for wide and narrow screens, and
  // hides one. A replay is heavy, so only the one on screen loads it.
  const isOnScreen = compact === useIsMobile()
  const { data: events, isError } = useQuery({
    queryKey: ["bug-report-replay", reportId],
    queryFn: () => loadReplayEvents(reportId),
    // A replay never changes: download and unpack it once.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    enabled: isOnScreen,
  })

  if (!isOnScreen) return null

  if (events) {
    return (
      <ReplayPlayer
        className="w-full overflow-hidden rounded-lg bg-black shadow-sm"
        events={events}
        onTimeUpdate={onTimeUpdate}
        ref={ref}
      />
    )
  }

  if (isError) {
    return (
      <p className="text-muted-foreground text-sm">
        The replay could not be loaded.
      </p>
    )
  }

  return (
    <div className="flex items-center gap-2 text-muted-foreground text-sm">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading the replay...
    </div>
  )
})

ReplayAttachment.displayName = "ReplayAttachment"
