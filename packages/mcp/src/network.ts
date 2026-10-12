import type { CrikketReader, NetworkRequestItem } from "./reader"

/** Largest page the network-requests procedure returns. */
const NETWORK_PAGE_SIZE = 200
/** Ingestion keeps at most 2000 requests per report; this leaves headroom. */
const MAX_NETWORK_PAGES = 15

/**
 * Loads every network request of a report, page by page, through the same
 * procedure the share page uses. Filtering by failure or method happens in
 * the caller, so the shared query code stays untouched.
 */
export async function fetchAllNetworkRequests(
  reader: CrikketReader,
  input: { id: string; search?: string; tabId?: number }
): Promise<NetworkRequestItem[]> {
  const firstPage = await reader.getNetworkRequestsPage({
    ...input,
    page: 1,
    perPage: NETWORK_PAGE_SIZE,
  })
  const totalPages = Math.min(
    firstPage.pagination.totalPages,
    MAX_NETWORK_PAGES
  )

  if (totalPages <= 1) {
    return firstPage.items
  }

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      reader.getNetworkRequestsPage({
        ...input,
        page: index + 2,
        perPage: NETWORK_PAGE_SIZE,
      })
    )
  )

  return [firstPage, ...remainingPages].flatMap((page) => page.items)
}
