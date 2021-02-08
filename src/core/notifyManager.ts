import { scheduleMicrotask } from './utils'

// TYPES

type NotifyCallback = () => void

type NotifyFunction = (callback: () => void) => void

type BatchNotifyFunction = (callback: () => void) => void

export type NotifyManager = {
  batch<T>(callback: () => T): T
  schedule(callback: NotifyCallback): void
  /**
   * All calls to the wrapped function will be batched.
   */
  batchCalls<T extends Function>(callback: T): T
  flush(): void
  /**
   * Use this method to set a custom notify function.
   * This can be used to for example wrap notifications with `React.act` while running tests.
   */
  setNotifyFunction(fn: NotifyFunction): void
  /**
   * Use this method to set a custom function to batch notifications together into a single tick.
   * By default React Query will use the batch function provided by ReactDOM or React Native.
   */
  setBatchNotifyFunction(fn: BatchNotifyFunction): void
}

function createNotifyManager(): NotifyManager {
  let queue: NotifyCallback[] = []
  let transactions = 0
  let notifyFn: NotifyFunction = (callback: () => void) => {
    callback()
  }
  let batchNotifyFn: BatchNotifyFunction = (callback: () => void) => {
    callback()
  }

  const notifyManager = {
    batch<T>(callback: () => T): T {
      transactions++
      const result = callback()
      transactions--
      if (!transactions) {
        notifyManager.flush()
      }
      return result
    },
    schedule(callback: NotifyCallback): void {
      if (transactions) {
        queue.push(callback)
      } else {
        scheduleMicrotask(() => {
          notifyFn(callback)
        })
      }
    },
    batchCalls<T extends Function>(callback: T): T {
      return ((...args: any[]) => {
        notifyManager.schedule(() => {
          callback(...args)
        })
      }) as any
    },
    flush(): void {
      if (queue.length) {
        scheduleMicrotask(() => {
          batchNotifyFn(() => {
            queue.forEach(callback => {
              notifyFn(callback)
            })
          })
        })
      }
      queue = []
    },
    setNotifyFunction(fn: NotifyFunction) {
      notifyFn = fn
    },
    setBatchNotifyFunction(fn: BatchNotifyFunction) {
      batchNotifyFn = fn
    },
  }

  return notifyManager
}

// SINGLETON

export const notifyManager = createNotifyManager()
