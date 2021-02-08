import { difference, getQueryKeyHashFn, replaceAt } from './utils'
import { notifyManager } from './notifyManager'
import type { QueryObserverOptions, QueryObserverResult } from './types'
import type { QueryClient } from './queryClient'
import { createQueryObserver, QueryObserver } from './queryObserver'
import { Subscribable } from './subscribable'

type QueriesObserverListener = (result: QueryObserverResult[]) => void

export type QueriesObserver = {
  subscribe: Subscribable<QueriesObserverListener>['subscribe']
  hasListeners: Subscribable<QueriesObserverListener>['hasListeners']
  destroy(): void
  setQueries(queries: QueryObserverOptions[]): void
  getCurrentResult(): QueryObserverResult[]
}

export function createQueriesObserver(
  client: QueryClient,
  initialQueries?: QueryObserverOptions[]
): QueriesObserver {
  let queries: QueryObserverOptions[] = initialQueries || []
  let result: QueryObserverResult[] = []
  let observers: QueryObserver[] = []

  const subscribable = Subscribable<QueriesObserverListener>({
    onSubscribe() {
      if (subscribable.listeners.length === 1) {
        observers.forEach(observer => {
          observer.subscribe(res => {
            onUpdate(observer, res)
          })
        })
      }
    },

    onUnsubscribe() {
      if (!subscribable.listeners.length) {
        queriesObserver.destroy()
      }
    },
  })

  // Subscribe to queries
  updateObservers()

  const queriesObserver: QueriesObserver = {
    subscribe: subscribable.subscribe,
    hasListeners: subscribable.hasListeners,
    destroy(): void {
      subscribable.listeners = []
      observers.forEach(observer => {
        observer.destroy()
      })
    },
    setQueries(newQueries: QueryObserverOptions[]): void {
      queries = newQueries
      updateObservers()
    },
    getCurrentResult(): QueryObserverResult[] {
      return result
    },
  }

  return queriesObserver

  function updateObservers(): void {
    let hasIndexChange = false

    const prevObservers = observers
    const newObservers = queries.map((options, i) => {
      let observer: QueryObserver | undefined = prevObservers[i]

      const defaultedOptions = client.defaultQueryObserverOptions(options)
      const hashFn = getQueryKeyHashFn(defaultedOptions)
      defaultedOptions.queryHash = hashFn(defaultedOptions.queryKey!)

      if (
        !observer ||
        observer.getCurrentQuery().queryHash !== defaultedOptions.queryHash
      ) {
        hasIndexChange = true
        observer = prevObservers.find(
          x => x.getCurrentQuery().queryHash === defaultedOptions.queryHash
        )
      }

      if (observer) {
        observer.setOptions(defaultedOptions)
        return observer
      }

      return createQueryObserver(client, defaultedOptions)
    })

    if (prevObservers.length === newObservers.length && !hasIndexChange) {
      return
    }

    observers = newObservers
    result = newObservers.map(observer => observer.getCurrentResult())

    if (!subscribable.listeners.length) {
      return
    }

    difference(prevObservers, newObservers).forEach(observer => {
      observer.destroy()
    })

    difference(newObservers, prevObservers).forEach(observer => {
      observer.subscribe(res => {
        onUpdate(observer, res)
      })
    })

    notify()
  }

  function onUpdate(observer: QueryObserver, res: QueryObserverResult): void {
    const index = observers.indexOf(observer)
    if (index !== -1) {
      result = replaceAt(result, index, res)
      notify()
    }
  }

  function notify(): void {
    notifyManager.batch(() => {
      subscribable.listeners.forEach(listener => {
        listener(result)
      })
    })
  }
}
