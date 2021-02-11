import { difference, getQueryKeyHashFn, replaceAt } from './utils'
import { notifyManager } from './notifyManager'
import type {
  QueryGenerics,
  QueryObserverOptions,
  QueryObserverResult,
} from './types'
import type { QueryClient } from './queryClient'
import { createQueryObserver, QueryObserver } from './queryObserver'
import { Subscribable } from './subscribable'

type QueriesObserverListener = (result: QueryObserverResult<any>[]) => void

export type QueriesObserver<TGenerics extends QueryGenerics> = {
  subscribe: Subscribable<QueriesObserverListener>['subscribe']
  hasListeners: Subscribable<QueriesObserverListener>['hasListeners']
  destroy(): void
  setQueries(queries: QueryObserverOptions<TGenerics>[]): void
  getCurrentResult(): QueryObserverResult<TGenerics>[]
}

export function createQueriesObserver<TGenerics extends QueryGenerics>(
  client: QueryClient,
  initialQueries?: QueryObserverOptions<TGenerics>[]
): QueriesObserver<TGenerics> {
  let queries: QueryObserverOptions<TGenerics>[] = initialQueries || []
  let result: QueryObserverResult<TGenerics>[] = []
  let observers: QueryObserver<TGenerics>[] = []

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

  const queriesObserver: QueriesObserver<TGenerics> = {
    subscribe: subscribable.subscribe,
    hasListeners: subscribable.hasListeners,
    destroy(): void {
      subscribable.listeners = []
      observers.forEach(observer => {
        observer.destroy()
      })
    },
    setQueries(newQueries: QueryObserverOptions<any>[]): void {
      queries = newQueries
      updateObservers()
    },
    getCurrentResult(): QueryObserverResult<TGenerics>[] {
      return result
    },
  }

  return queriesObserver

  function updateObservers(): void {
    let hasIndexChange = false

    const prevObservers = observers
    const newObservers = queries.map((options, i) => {
      let observer: QueryObserver<TGenerics> | undefined = prevObservers[i]

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

  function onUpdate(
    observer: QueryObserver<TGenerics>,
    res: QueryObserverResult<TGenerics>
  ): void {
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
