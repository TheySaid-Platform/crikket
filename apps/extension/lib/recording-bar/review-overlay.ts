// The review is the extension's own page in an iframe, so the page cannot
// reach into it.

import { REVIEW_WIDE_QUERY_PARAM } from "@/lib/background-recording/protocol"

const OVERLAY_ID = "crikket-review-overlay"

let previousOverflow: string | null = null
let shownUrl: string | null = null

export function openReviewOverlay(url: string): void {
  // Asked again (after a reload check, or from the popup) while it shows.
  if (shownUrl === url && document.getElementById(OVERLAY_ID)) return
  closeReviewOverlay()
  shownUrl = url

  const host = document.createElement("div")
  host.id = OVERLAY_ID
  host.style.cssText =
    "all:initial;position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(15,15,20,0.55);"

  const shadow = host.attachShadow({ mode: "closed" })
  const frame = document.createElement("iframe")
  frame.src = url
  frame.title = "Crikket bug report"
  frame.allow = "clipboard-write"
  // A long screenshot gets more room, to show at the size it had on the page.
  const maxWidth = new URL(url).searchParams.has(REVIEW_WIDE_QUERY_PARAM)
    ? 1600
    : 1200
  frame.style.cssText = `width:min(${maxWidth}px,96vw);height:min(900px,94vh);border:0;border-radius:16px;background:#fff;box-shadow:0 24px 60px rgba(0,0,0,0.4);`
  shadow.append(frame)

  previousOverflow = document.documentElement.style.overflow
  document.documentElement.style.overflow = "hidden"
  document.documentElement.append(host)
}

export function closeReviewOverlay(): void {
  shownUrl = null
  const host = document.getElementById(OVERLAY_ID)
  if (!host) return
  host.remove()
  if (previousOverflow !== null) {
    document.documentElement.style.overflow = previousOverflow
    previousOverflow = null
  }
}
