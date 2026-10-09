import type { PendingReview } from "./protocol"

/**
 * After a browser restart: which stored captures to remove, and which review
 * tab Chrome restored becomes the unsent review again. A restored review still
 * works from its logs copy, so its capture is kept.
 */
export function planStartupCleanup(input: {
  storedIds: string[]
  liveSessionIds: Set<string>
  reviewTabs: Map<string, PendingReview>
}): { remove: string[]; pending: PendingReview | null } {
  const remove: string[] = []
  let pending: PendingReview | null = null
  for (const sessionId of input.storedIds) {
    const review = input.reviewTabs.get(sessionId)
    if (review) {
      pending ??= review
    } else if (!input.liveSessionIds.has(sessionId)) {
      remove.push(sessionId)
    }
  }
  return { remove, pending }
}
