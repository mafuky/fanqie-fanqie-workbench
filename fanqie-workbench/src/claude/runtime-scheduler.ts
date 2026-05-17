type QueueItem<T> = {
  bookId: string
  work: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

export type RuntimeScheduler = {
  run<T>(input: { bookId: string }, work: () => Promise<T>): Promise<T>
  getSnapshot(): { runningBookIds: string[]; queuedCount: number }
}

export function createRuntimeScheduler(input: { maxConcurrentBooks: number }): RuntimeScheduler {
  const maxConcurrentBooks = Math.max(1, input.maxConcurrentBooks)
  const runningBookIds = new Set<string>()
  const queue: Array<QueueItem<unknown>> = []
  let pumpScheduled = false

  const schedulePump = () => {
    if (pumpScheduled) return
    pumpScheduled = true
    queueMicrotask(pump)
  }

  const pump = () => {
    pumpScheduled = false

    while (runningBookIds.size < maxConcurrentBooks) {
      const nextIndex = queue.findIndex((item) => !runningBookIds.has(item.bookId))
      if (nextIndex === -1) return

      const [next] = queue.splice(nextIndex, 1)
      runningBookIds.add(next.bookId)

      void Promise.resolve()
        .then(() => next.work())
        .then((value) => next.resolve(value))
        .catch((error) => next.reject(error))
        .finally(() => {
          runningBookIds.delete(next.bookId)
          schedulePump()
        })
    }
  }

  return {
    run<T>(runInput: { bookId: string }, work: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({
          bookId: runInput.bookId,
          work,
          resolve: resolve as (value: unknown) => void,
          reject,
        })
        schedulePump()
      })
    },

    getSnapshot() {
      return {
        runningBookIds: [...runningBookIds],
        queuedCount: queue.length,
      }
    },
  }
}

export const defaultRuntimeScheduler = createRuntimeScheduler({ maxConcurrentBooks: 2 })
