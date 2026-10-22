"use client"

import { Button, buttonVariants } from "@crikket/ui/components/ui/button"
import { cn } from "@crikket/ui/lib/utils"
import { Chrome, Loader2, Play } from "lucide-react"

import { SelectionActionBar } from "@/components/selection-action-bar"
import { useBugReportsActions } from "../../_hooks/use-bug-reports-actions"
import { useBugReportsData } from "../../_hooks/use-bug-reports-data"
import { useBugReportsFilters } from "../../_hooks/use-bug-reports-filters"
import { useBugReportsView } from "../../_hooks/use-bug-reports-view"
import { BugReportCard } from "./bug-report-card"
import { BugReportsBulkActions } from "./bug-reports-bulk-actions"
import { BugReportsDeleteDialogs } from "./bug-reports-delete-dialogs"
import { BugReportsToolbar } from "./bug-reports-toolbar"

export function BugReportsList() {
  const filtersState = useBugReportsFilters()
  const { view, setView } = useBugReportsView()
  const layoutClassName =
    view === "list"
      ? "flex flex-col gap-2"
      : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"

  const {
    reports,
    stats,
    refetchAll,
    isError,
    errorMessage,
    isLoading,
    isFetching,
    refetch,
    loadMoreRef,
  } = useBugReportsData({
    search: filtersState.debouncedSearch,
    sort: filtersState.sort,
    filters: filtersState.filters,
  })

  const actionsState = useBugReportsActions({
    reportIds: reports.map((report) => report.id),
    refetchAll,
  })

  return (
    <div
      className={
        actionsState.selectedCount > 0
          ? "space-y-4 pb-40 sm:pb-32 lg:pb-28"
          : "space-y-4"
      }
    >
      <BugReportsToolbar
        filters={filtersState.filters}
        onClearFilters={filtersState.clearFilters}
        onSearchChange={filtersState.setSearchValue}
        onSortChange={filtersState.setSort}
        onTogglePriority={filtersState.togglePriority}
        onToggleStatus={filtersState.toggleStatus}
        onToggleVisibility={filtersState.toggleVisibility}
        onViewChange={setView}
        search={filtersState.searchValue}
        sort={filtersState.sort}
        stats={stats}
        view={view}
      />

      <SelectionActionBar
        actions={
          <BugReportsBulkActions
            bulkPriority={actionsState.bulkPriority}
            bulkStatus={actionsState.bulkStatus}
            bulkTagsInput={actionsState.bulkTagsInput}
            bulkVisibility={actionsState.bulkVisibility}
            isMutating={actionsState.isMutating}
            onApplyUpdates={actionsState.handleBulkUpdate}
            onBulkPriorityChange={actionsState.setBulkPriority}
            onBulkStatusChange={actionsState.setBulkStatus}
            onBulkTagsChange={actionsState.setBulkTagsInput}
            onBulkVisibilityChange={actionsState.setBulkVisibility}
            onRequestBulkDelete={() => actionsState.setBulkDeleteOpen(true)}
          />
        }
        onClearSelection={actionsState.clearSelection}
        selectedCount={actionsState.selectedCount}
      />

      {isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium text-sm">Failed to load bug reports</p>
          <p className="mt-1 text-muted-foreground text-sm">
            {errorMessage || "Unexpected error"}
          </p>
          <Button
            className="mt-3"
            onClick={() => refetch()}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}

      {isLoading ? (
        <div className={layoutClassName}>
          {["s1", "s2", "s3", "s4"].map((skeletonKey) => (
            <div
              className={cn(
                "w-full animate-pulse rounded-lg bg-muted",
                view === "list" ? "h-20" : "aspect-video"
              )}
              key={skeletonKey}
            />
          ))}
        </div>
      ) : null}

      {!isLoading && reports.length === 0 && !isError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border py-20">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <Play className="h-10 w-10 text-muted-foreground" />
          </div>
          <div className="text-center">
            <h2 className="font-semibold text-2xl">
              {filtersState.hasActiveFilters
                ? "No matching reports"
                : "No bug reports yet"}
            </h2>
            <p className="mt-2 text-muted-foreground text-sm">
              {filtersState.hasActiveFilters
                ? "Try adjusting your search or filters."
                : "Install the Chrome extension to start reporting bugs."}
            </p>
          </div>
          {filtersState.hasActiveFilters ? null : (
            <a
              className={cn(buttonVariants(), "mt-2")}
              href="https://chromewebstore.google.com/detail/crikket/pjooelapomplepemjoebeanebffdieic"
              rel="noopener noreferrer"
              target="_blank"
            >
              <Chrome />
              Install the Chrome Extension
            </a>
          )}
        </div>
      ) : null}

      {reports.length > 0 ? (
        <div className={layoutClassName}>
          {reports.map((report) => (
            <BugReportCard
              isChecked={actionsState.selectedIds.has(report.id)}
              isMutating={actionsState.isMutating}
              key={report.id}
              onReportUpdated={refetchAll}
              onRequestDelete={() => actionsState.setDeleteReportId(report.id)}
              onRetryDebuggerIngestion={() =>
                actionsState.retryIngestionMutation.mutate(report.id)
              }
              onToggleSelection={(checked) =>
                actionsState.toggleSelection(report.id, checked)
              }
              onUpdateReport={(input) =>
                actionsState.updateMutation.mutate({
                  id: report.id,
                  ...input,
                })
              }
              report={report}
              view={view}
            />
          ))}
        </div>
      ) : null}

      {isFetching ? (
        <div className="flex justify-center py-2">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}

      <div aria-hidden className="h-1 w-full" ref={loadMoreRef} />

      <BugReportsDeleteDialogs
        bulkDeleteOpen={actionsState.bulkDeleteOpen}
        deleteReportId={actionsState.deleteReportId}
        isBulkDeleteLoading={actionsState.bulkDeleteMutation.isPending}
        isSingleDeleteLoading={actionsState.deleteMutation.isPending}
        onBulkDeleteConfirm={actionsState.handleBulkDelete}
        onBulkDeleteOpenChange={actionsState.setBulkDeleteOpen}
        onSingleDeleteConfirm={async () => {
          if (!actionsState.deleteReportId) {
            return
          }

          await actionsState.deleteMutation.mutateAsync(
            actionsState.deleteReportId
          )
          actionsState.setDeleteReportId(null)
        }}
        onSingleDeleteOpenChange={(open) => {
          if (!open) {
            actionsState.setDeleteReportId(null)
          }
        }}
        selectedCount={actionsState.selectedCount}
      />
    </div>
  )
}
