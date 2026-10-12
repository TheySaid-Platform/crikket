import type { CrikketReader, NetworkRequestItem } from "./reader"

/** Largest page the network-requests procedure returns. */
const NETWORK_PAGE_SIZE = 200
/** Ingestion keeps at most 2000 requests per report; this leaves headroom. */
const MAX_NETWORK_PAGES = 15

export interface AllNetworkRequests {
  items: NetworkRequestItem[]
  /** How many requests the database reported for this filter. */
  expectedTotal: number
}

/**
 * Loads every network request of a report, page by page, through the same
 * procedure the share page uses. Pages are ordered by (timestamp, id), so
 * fetching them in parallel neither repeats nor skips a row; the merge still
 * drops duplicate ids, and callers compare `items.length` with
 * `expectedTotal` to say when the list is short.
 */
export async function fetchAllNetworkRequests(
  reader: CrikketReader,
  input: { id: string; search?: string; tabId?: number }
): Promise<AllNetworkRequests> {
  const firstPage = await reader.getNetworkRequestsPage({
    ...input,
    page: 1,
    perPage: NETWORK_PAGE_SIZE,
  })
  const totalPages = Math.min(
    firstPage.pagination.totalPages,
    MAX_NETWORK_PAGES
  )

  const remainingPages =
    totalPages > 1
      ? await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            reader.getNetworkRequestsPage({
              ...input,
              page: index + 2,
              perPage: NETWORK_PAGE_SIZE,
            })
          )
        )
      : []

  const byId = new Map<string, NetworkRequestItem>()
  for (const page of [firstPage, ...remainingPages]) {
    for (const item of page.items) {
      byId.set(item.id, item)
    }
  }

  return {
    items: [...byId.values()],
    expectedTotal: firstPage.pagination.totalItems,
  }
}

export function describeMissingRequests(
  requests: AllNetworkRequests
): string | null {
  const missing = requests.expectedTotal - requests.items.length
  return missing > 0
    ? `${missing} of ${requests.expectedTotal} network requests could not be loaded, so this list is incomplete.`
    : null
}
