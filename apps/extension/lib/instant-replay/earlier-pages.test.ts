import { describe, expect, it } from "bun:test"
import { EventType } from "@rrweb/types"
import { createEarlierPages } from "./earlier-pages"
import { INSTANT_REPLAY_WINDOW_MS, type ReplayEvent } from "./protocol"

const NOW = 10 * 60_000
const SHOP = "https://shop.example.com"
const BANK = "https://bank.example.com"

// A page that opened at `from` and was left at `to`.
function page(from: number, to: number): ReplayEvent[] {
  return [
    {
      type: EventType.Meta,
      data: { href: "https://example.com", width: 1280, height: 720 },
      timestamp: from,
    },
    {
      type: EventType.Custom,
      data: { tag: "left", payload: {} },
      timestamp: to,
    },
  ]
}

function add(
  pages: ReturnType<typeof createEarlierPages>,
  input: {
    tabId?: number
    origin?: string
    events: ReplayEvent[]
    chars?: number
  }
) {
  pages.add(
    {
      tabId: input.tabId ?? 1,
      origin: input.origin ?? SHOP,
      events: input.events,
      chars: input.chars ?? 100,
    },
    NOW
  )
}

const timestamps = (events: ReplayEvent[]) =>
  events.map((event) => event.timestamp)

describe("earlier pages", () => {
  it("keeps the tab's pages in order", () => {
    const pages = createEarlierPages()
    add(pages, { events: page(NOW - 60_000, NOW - 40_000) })
    add(pages, { tabId: 2, events: page(NOW - 50_000, NOW - 45_000) })
    add(pages, { events: page(NOW - 40_000, NOW - 20_000) })

    expect(timestamps(pages.get(1, SHOP, NOW))).toEqual([
      NOW - 60_000,
      NOW - 40_000,
      NOW - 40_000,
      NOW - 20_000,
    ])
  })

  it("only keeps pages of the site the tab shows now, since it came to it", () => {
    const pages = createEarlierPages()
    add(pages, { events: page(NOW - 90_000, NOW - 80_000) })
    add(pages, { origin: BANK, events: page(NOW - 80_000, NOW - 60_000) })
    add(pages, { events: page(NOW - 60_000, NOW - 30_000) })

    expect(timestamps(pages.get(1, SHOP, NOW))).toEqual([
      NOW - 60_000,
      NOW - 30_000,
    ])
    expect(pages.get(1, "https://other.example.com", NOW)).toEqual([])
  })

  it("drops pages older than the window", () => {
    const pages = createEarlierPages()
    add(pages, {
      events: page(
        NOW - INSTANT_REPLAY_WINDOW_MS - 60_000,
        NOW - INSTANT_REPLAY_WINDOW_MS - 1
      ),
    })
    add(pages, { events: page(NOW - 20_000, NOW - 10_000) })

    expect(timestamps(pages.get(1, SHOP, NOW))).toEqual([
      NOW - 20_000,
      NOW - 10_000,
    ])
  })

  it("drops events dated in the future", () => {
    const pages = createEarlierPages()
    add(pages, { events: page(NOW - 10_000, NOW + 60 * 60_000) })
    add(pages, { events: page(NOW + 1, NOW + 2) })

    expect(timestamps(pages.get(1, SHOP, NOW))).toEqual([NOW - 10_000])
  })

  it("keeps all tabs' pages under the size limit, dropping the oldest", () => {
    const pages = createEarlierPages(1000)
    add(pages, {
      tabId: 1,
      events: page(NOW - 30_000, NOW - 20_000),
      chars: 400,
    })
    add(pages, {
      tabId: 2,
      events: page(NOW - 20_000, NOW - 10_000),
      chars: 400,
    })
    add(pages, { tabId: 3, events: page(NOW - 10_000, NOW - 5000), chars: 400 })
    // Bigger than all of it: refused.
    add(pages, { tabId: 4, events: page(NOW - 5000, NOW), chars: 1001 })

    expect(pages.get(1, SHOP, NOW)).toEqual([])
    expect(pages.get(2, SHOP, NOW)).toHaveLength(2)
    expect(pages.get(3, SHOP, NOW)).toHaveLength(2)
    expect(pages.get(4, SHOP, NOW)).toEqual([])
  })

  it("forgets a closed tab", () => {
    const pages = createEarlierPages()
    add(pages, { events: page(NOW - 20_000, NOW - 10_000) })
    pages.deleteTab(1)

    expect(pages.get(1, SHOP, NOW)).toEqual([])
  })
})
