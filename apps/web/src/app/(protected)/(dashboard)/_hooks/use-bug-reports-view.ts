"use client"

import { useEffect, useState } from "react"

export type BugReportsView = "grid" | "list"

const VIEW_STORAGE_KEY = "crikket:bug-reports-view"

export function useBugReportsView() {
  // Start on "grid" and read storage after mount so the server and client render the same markup.
  const [view, setViewState] = useState<BugReportsView>("grid")

  useEffect(() => {
    if (window.localStorage.getItem(VIEW_STORAGE_KEY) === "list") {
      setViewState("list")
    }
  }, [])

  const setView = (nextView: BugReportsView) => {
    setViewState(nextView)
    window.localStorage.setItem(VIEW_STORAGE_KEY, nextView)
  }

  return { view, setView }
}
