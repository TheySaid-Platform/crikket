import { cn } from "@crikket/ui/lib/utils"
import { MousePointerClick } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"

import { buildReproductionSteps } from "./reproduction-steps"
import { TabBadge } from "./tab-badge"
import type { DebuggerAction, DebuggerTimelineEntry } from "./types"

interface ReproductionStepsListProps {
  actions: DebuggerAction[]
  entries: DebuggerTimelineEntry[]
  highlightedIds: string[]
  onSelect: (entry: DebuggerTimelineEntry) => void
  selectedId: string | null
}

export function ReproductionStepsList({
  actions,
  entries,
  highlightedIds,
  onSelect,
  selectedId,
}: ReproductionStepsListProps) {
  const listContainerRef = useRef<HTMLDivElement | null>(null)
  const highlightedIdSet = useMemo(
    () => new Set(highlightedIds),
    [highlightedIds]
  )
  const steps = useMemo(
    () =>
      buildReproductionSteps({
        actions,
        entries,
      }),
    [actions, entries]
  )

  useEffect(() => {
    if (!(selectedId && listContainerRef.current)) {
      return
    }

    const escapedSelectedId = CSS.escape(selectedId)
    const selectedRow = listContainerRef.current.querySelector<HTMLElement>(
      `[data-step-action-ids~="${escapedSelectedId}"]`
    )

    selectedRow?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    })
  }, [selectedId])

  if (steps.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
        <div className="mb-2 rounded-full bg-muted p-2 opacity-50">
          <MousePointerClick className="h-3 w-3" />
        </div>
        <p className="text-xs">No user actions captured.</p>
      </div>
    )
  }

  return (
    <div
      className="h-full overflow-y-auto border-t bg-background"
      ref={listContainerRef}
    >
      <ol className="divide-y">
        {steps.map((step) => {
          const isSelected = step.actionIds.includes(selectedId ?? "")
          const isHighlighted = step.actionIds.some((actionId) =>
            highlightedIdSet.has(actionId)
          )

          return (
            <li key={step.id}>
              <button
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/30 focus:bg-muted/30 focus:outline-none",
                  isHighlighted && "bg-primary/5",
                  isSelected &&
                    "bg-muted/50 shadow-[inset_3px_0_0_0] shadow-primary"
                )}
                data-step-action-ids={step.actionIds.join(" ")}
                onClick={() => onSelect(step.selectedEntry)}
                type="button"
              >
                <div className="flex shrink-0 flex-col items-center">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full font-medium font-mono text-[11px]",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {step.sequence}
                  </div>
                  <div
                    aria-hidden="true"
                    className={cn(
                      "mt-2 w-px flex-1 bg-border",
                      step.sequence === steps.length && "bg-transparent"
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-foreground text-sm leading-5">
                      {step.title}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      {step.selectedEntry.tabLabel ? (
                        <TabBadge label={step.selectedEntry.tabLabel} />
                      ) : null}
                      {step.timeLabel ? (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {step.timeLabel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {step.summary ? (
                    <p className="text-muted-foreground text-xs leading-4">
                      {step.summary}
                    </p>
                  ) : null}
                  {step.targetLabel && step.targetLabel !== step.summary ? (
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {step.targetLabel}
                    </p>
                  ) : null}
                </div>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
