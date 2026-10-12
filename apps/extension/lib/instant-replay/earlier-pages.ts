import { INSTANT_REPLAY_WINDOW_MS, type ReplayEvent } from "./protocol"

// What the earlier pages of all tabs may hold together, in characters of the
// JSON they sent. A page sends its own events, so it could send anything.
export const MAX_EARLIER_PAGES_CHARS = 32 * 1024 * 1024

interface EarlierPage {
  tabId: number
  origin: string
  events: ReplayEvent[]
  chars: number
  lastAt: number
}

/**
 * What earlier pages of each tab recorded. A reload or navigation ends the
 * page's recorder, and it hands its events over before it goes.
 */
export function createEarlierPages(maxChars = MAX_EARLIER_PAGES_CHARS) {
  let pages: EarlierPage[] = []

  const dropOld = (now: number) => {
    const cut = now - INSTANT_REPLAY_WINDOW_MS
    pages = pages.filter((page) => page.lastAt >= cut)
  }

  return {
    add(
      page: {
        tabId: number
        origin: string
        events: ReplayEvent[]
        chars: number
      },
      now: number
    ): void {
      if (page.chars > maxChars) return
      // The page dates its own events; ones in the future would never age out.
      const events = page.events.filter((event) => event.timestamp <= now)
      const lastAt = events.at(-1)?.timestamp
      if (lastAt === undefined) return
      pages.push({ ...page, events, lastAt })
      dropOld(now)
      let total = pages.reduce((sum, kept) => sum + kept.chars, 0)
      while (total > maxChars) {
        total -= pages.shift()?.chars ?? 0
      }
    },

    /**
     * The tab's earlier pages since it came to `origin`, the site it shows
     * now. A replay never shows another site the user did not mean to share.
     */
    get(tabId: number, origin: string, now: number): ReplayEvent[] {
      dropOld(now)
      const tabPages = pages.filter((page) => page.tabId === tabId)
      const lastOtherSite = tabPages.findLastIndex(
        (page) => page.origin !== origin
      )
      return tabPages.slice(lastOtherSite + 1).flatMap((page) => page.events)
    },

    deleteTab(tabId: number): void {
      pages = pages.filter((page) => page.tabId !== tabId)
    },

    clear(): void {
      pages = []
    },
  }
}
