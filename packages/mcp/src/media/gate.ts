export class MediaBusyError extends Error {}

/**
 * Lets at most `concurrency` tasks run at once in this pod. A task that
 * cannot start within `waitMs` fails with MediaBusyError instead of piling up.
 * A finishing task hands its slot straight to the next waiter, so a new
 * caller can never slip in between.
 */
export function createGate(concurrency: number) {
  let running = 0
  const waiting: (() => void)[] = []

  const release = () => {
    const next = waiting.shift()
    if (next) {
      next()
    } else {
      running -= 1
    }
  }

  const waitForSlot = (waitMs: number) =>
    new Promise<void>((resolve, reject) => {
      const start = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        const index = waiting.indexOf(start)
        if (index !== -1) {
          waiting.splice(index, 1)
        }
        reject(new MediaBusyError("Another video is being processed"))
      }, waitMs)
      waiting.push(start)
    })

  return async function runGated<T>(
    waitMs: number,
    task: () => Promise<T>
  ): Promise<T> {
    if (running < concurrency) {
      running += 1
    } else {
      await waitForSlot(waitMs)
    }

    try {
      return await task()
    } finally {
      release()
    }
  }
}
