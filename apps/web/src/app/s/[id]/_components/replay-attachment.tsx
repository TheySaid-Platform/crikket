"use client"

import {
  type PlaybackHandle,
  type ReplayEvents,
  ReplayPlayer,
} from "@crikket/ui/components/replay-player"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { forwardRef, useMemo } from "react"
import { orpc } from "@/utils/orpc"

interface ReplayAttachmentProps {
  reportId: string
  onTimeUpdate?: (currentTimeMs: number) => void
}

/** An instant replay: the page rebuilt from its recorded changes. */
export const ReplayAttachment = forwardRef<
  PlaybackHandle,
  ReplayAttachmentProps
>(({ reportId, onTimeUpdate }, ref) => {
  const { data, error, isLoading } = useQuery(
    orpc.bugReport.getReplay.queryOptions({ input: { id: reportId } })
  )
  const events = useMemo(
    () => (data ? (JSON.parse(data.events) as ReplayEvents) : null),
    [data]
  )

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading the replay...
      </div>
    )
  }

  if (error || !events) {
    return (
      <p className="text-muted-foreground text-sm">
        The replay could not be loaded.
      </p>
    )
  }

  return (
    <ReplayPlayer
      className="w-full overflow-hidden rounded-lg bg-black shadow-sm"
      events={events}
      onTimeUpdate={onTimeUpdate}
      ref={ref}
    />
  )
})

ReplayAttachment.displayName = "ReplayAttachment"
