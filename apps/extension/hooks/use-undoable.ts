import { useCallback, useState } from "react"

interface History<T> {
  past: T[]
  present: T
  future: T[]
}

const MAX_UNDO_STEPS = 100

/** A value with undo and redo, for the screenshot and video editors. */
export function useUndoable<T>(initial: T) {
  const [history, setHistory] = useState<History<T>>({
    past: [],
    present: initial,
    future: [],
  })

  const update = useCallback((change: (current: T) => T) => {
    setHistory((current) => {
      const next = change(current.present)
      if (Object.is(next, current.present)) return current
      return {
        past: [...current.past, current.present].slice(-MAX_UNDO_STEPS),
        present: next,
        future: [],
      }
    })
  }, [])

  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.past.length === 0) return current
      return {
        past: current.past.slice(0, -1),
        present: current.past.at(-1) as T,
        future: [current.present, ...current.future],
      }
    })
  }, [])

  const redo = useCallback(() => {
    setHistory((current) => {
      const [next, ...rest] = current.future
      if (current.future.length === 0) return current
      return {
        past: [...current.past, current.present],
        present: next as T,
        future: rest,
      }
    })
  }, [])

  return {
    value: history.present,
    update,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  }
}
