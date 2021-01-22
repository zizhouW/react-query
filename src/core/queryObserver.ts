import {
  getStatusProps,
  isServer,
  isValidTimeout,
  noop,
  replaceEqualDeep,
  shallowEqualObjects,
  timeUntilStale,
} from './utils'
import { notifyManager } from './notifyManager'
import type {
  PlaceholderDataFunction,
  QueryObserverBaseResult,
  QueryObserverOptions,
  QueryObserverResult,
  QueryOptions,
  RefetchOptions,
  ResultOptions,
} from './types'
import type { Query, QueryState, Action, FetchOptions } from './query'
import type { QueryClient } from './queryClient'
import { focusManager } from './focusManager'
import { Subscribable } from './subscribable'

export type QueryObserverListener<TData, TError> = (
  result: QueryObserverResult<TData, TError>
) => void

interface NotifyOptions {
  cache?: boolean
  listeners?: boolean
  onError?: boolean
  onSuccess?: boolean
}

export interface ObserverFetchOptions extends FetchOptions {
  throwOnError?: boolean
}

export type QueryObserver<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryData = TQueryFnData
> = {
  options: QueryObserverOptions<TQueryFnData, TError, TData, TQueryData>
  subscribe: Subscribable<QueryObserverListener<TData, TError>>['subscribe']
  hasListeners: Subscribable<
    QueryObserverListener<TData, TError>
  >['hasListeners']
  willLoadOnMount(): boolean
  willRefetchOnMount(): boolean
  willFetchOnMount(): boolean
  willFetchOnReconnect(): boolean
  willFetchOnWindowFocus(): boolean
  destroy(): void
  setOptions(
    newOptions?: QueryObserverOptions<TQueryFnData, TError, TData, TQueryData>
  ): void
  getCurrentResult(): QueryObserverResult<TData, TError>
  getNextResult(
    resultOptions?: ResultOptions
  ): Promise<QueryObserverResult<TData, TError>>
  getCurrentQuery(): Query<TQueryFnData, TError, TQueryData>
  getNewResult(willFetch?: boolean): QueryObserverResult<TData, TError>
  remove(): void
  fetch(
    fetchOptions?: ObserverFetchOptions
  ): Promise<QueryObserverResult<TData, TError>>
  refetch(
    refetchOptions?: RefetchOptions
  ): Promise<QueryObserverResult<TData, TError>>
  onQueryUpdate(action: Action<TData, TError>): void
}

export function makeQueryObserver<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryData = TQueryFnData
>(
  client: QueryClient,
  observerOptions: QueryObserverOptions<TQueryFnData, TError, TData, TQueryData>
) {
  let currentQuery: Query<TQueryFnData, TError, TQueryData>
  let currentResult: QueryObserverResult<TData, TError>
  let currentResultState: QueryState<TQueryData, TError>
  let previousQueryResult: QueryObserverResult<TData, TError>
  let initialDataUpdateCount: number
  let initialErrorUpdateCount: number
  let staleTimeoutId: number | undefined
  let refetchIntervalId: number | undefined

  const subscribable = Subscribable<QueryObserverListener<TData, TError>>({
    onSubscribe(): void {
      if (subscribable.listeners.length === 1) {
        updateQuery()

        currentQuery.addObserver(observer)

        if (observer.willFetchOnMount()) {
          executeFetch()
        }

        updateTimers()
      }
    },
    onUnsubscribe(): void {
      if (!subscribable.listeners.length) {
        observer.destroy()
      }
    },
  })

  const observer: QueryObserver<TQueryFnData, TError, TData, TQueryData> = {
    subscribe: subscribable.subscribe,
    hasListeners: subscribable.hasListeners,
    options: observerOptions,
    willLoadOnMount: () => {
      return (
        observer.options.enabled !== false &&
        !currentQuery.state.dataUpdatedAt &&
        !(
          currentQuery.state.status === 'error' &&
          observer.options.retryOnMount === false
        )
      )
    },
    willRefetchOnMount: () => {
      return (
        observer.options.enabled !== false &&
        currentQuery.state.dataUpdatedAt > 0 &&
        (observer.options.refetchOnMount === 'always' ||
          (observer.options.refetchOnMount !== false && isStale()))
      )
    },
    willFetchOnMount: () => {
      return observer.willLoadOnMount() || observer.willRefetchOnMount()
    },
    willFetchOnReconnect: () => {
      return (
        observer.options.enabled !== false &&
        (observer.options.refetchOnReconnect === 'always' ||
          (observer.options.refetchOnReconnect !== false && isStale()))
      )
    },
    willFetchOnWindowFocus: () => {
      return (
        observer.options.enabled !== false &&
        (observer.options.refetchOnWindowFocus === 'always' ||
          (observer.options.refetchOnWindowFocus !== false && isStale()))
      )
    },
    destroy: () => {
      subscribable.listeners = []
      clearTimers()
      currentQuery.removeObserver(observer)
    },
    setOptions: newOptions => {
      const prevOptions = observer.options
      const prevQuery = currentQuery

      observer.options = client.defaultQueryObserverOptions(newOptions)

      if (
        typeof observer.options.enabled !== 'undefined' &&
        typeof observer.options.enabled !== 'boolean'
      ) {
        throw new Error('Expected enabled to be a boolean')
      }

      // Keep previous query key if the user does not supply one
      if (!observer.options.queryKey) {
        observer.options.queryKey = prevOptions?.queryKey
      }

      updateQuery()

      // Take no further actions if there are no subscribers
      if (!subscribable.listeners.length) {
        return
      }

      // If we subscribed to a new query, optionally fetch and update refetch
      if (currentQuery !== prevQuery) {
        optionalFetch()
        updateTimers()
        return
      }

      // Optionally fetch if the query became enabled
      if (
        observer.options.enabled !== false &&
        prevOptions?.enabled === false
      ) {
        optionalFetch()
      }

      // Update stale interval if needed
      if (
        observer.options.enabled !== prevOptions?.enabled ||
        observer.options.staleTime !== prevOptions?.staleTime
      ) {
        updateStaleTimeout()
      }

      // Update refetch interval if needed
      if (
        observer.options.enabled !== prevOptions?.enabled ||
        observer.options.refetchInterval !== prevOptions?.refetchInterval
      ) {
        updateRefetchInterval()
      }
    },
    getCurrentResult: () => {
      return currentResult
    },
    getNextResult: resultOptions => {
      return new Promise((resolve, reject) => {
        const unsubscribe = subscribable.subscribe(result => {
          if (!result.isFetching) {
            unsubscribe()
            if (result.isError && resultOptions?.throwOnError) {
              reject(result.error)
            } else {
              resolve(result)
            }
          }
        })
      })
    },
    getCurrentQuery: () => {
      return currentQuery
    },
    getNewResult: willFetch => {
      const { state } = currentQuery
      let { isFetching, status } = state
      let isPreviousData = false
      let isPlaceholderData = false
      let data: TData | undefined
      let dataUpdatedAt = state.dataUpdatedAt

      // Optimistically set status to loading if we will start fetching
      if (willFetch) {
        isFetching = true
        if (!dataUpdatedAt) {
          status = 'loading'
        }
      }

      // Keep previous data if needed
      if (
        observer.options.keepPreviousData &&
        !state.dataUpdateCount &&
        previousQueryResult?.isSuccess
      ) {
        data = previousQueryResult.data
        dataUpdatedAt = previousQueryResult.dataUpdatedAt
        status = previousQueryResult.status
        isPreviousData = true
      }
      // Select data if needed
      else if (observer.options.select && typeof state.data !== 'undefined') {
        // Use the previous select result if the query data did not change
        if (currentResult && state.data === currentResultState?.data) {
          data = currentResult.data
        } else {
          data = observer.options.select(state.data)
          if (observer.options.structuralSharing !== false) {
            data = replaceEqualDeep(currentResult?.data, data)
          }
        }
      }
      // Use query data
      else {
        data = (state.data as unknown) as TData
      }

      // Show placeholder data if needed
      if (
        typeof observer.options.placeholderData !== 'undefined' &&
        typeof data === 'undefined' &&
        status === 'loading'
      ) {
        const placeholderData =
          typeof observer.options.placeholderData === 'function'
            ? (observer.options.placeholderData as PlaceholderDataFunction<
                TData
              >)()
            : observer.options.placeholderData
        if (typeof placeholderData !== 'undefined') {
          status = 'success'
          data = placeholderData
          isPlaceholderData = true
        }
      }

      const result: QueryObserverBaseResult<TData, TError> = {
        ...getStatusProps(status),
        data,
        dataUpdatedAt,
        error: state.error,
        errorUpdatedAt: state.errorUpdatedAt,
        failureCount: state.fetchFailureCount,
        isFetched: state.dataUpdateCount > 0 || state.errorUpdateCount > 0,
        isFetchedAfterMount:
          state.dataUpdateCount > initialDataUpdateCount ||
          state.errorUpdateCount > initialErrorUpdateCount,
        isFetching,
        isLoadingError: status === 'error' && state.dataUpdatedAt === 0,
        isPlaceholderData,
        isPreviousData,
        isRefetchError: status === 'error' && state.dataUpdatedAt !== 0,
        isStale: isStale(),
        refetch: observer.refetch,
        remove: observer.remove,
      }

      return result as QueryObserverResult<TData, TError>
    },
    remove: () => {
      client.getQueryCache().remove(currentQuery)
    },
    fetch: fetchOptions => {
      return executeFetch(fetchOptions).then(() => {
        updateResult()
        return currentResult
      })
    },
    refetch: refetchOptions => {
      return observer.fetch(refetchOptions)
    },
    onQueryUpdate: action => {
      // Store current result and get new result
      const prevResult = currentResult
      updateResult()

      // Update timers
      updateTimers()

      // Do not notify if the nothing has changed
      if (prevResult === currentResult) {
        return
      }

      // Determine which callbacks to trigger
      const notifyOptions: NotifyOptions = {}

      if (action.type === 'success') {
        notifyOptions.onSuccess = true
      } else if (action.type === 'error') {
        notifyOptions.onError = true
      }

      if (shouldNotifyListeners(prevResult, currentResult)) {
        notifyOptions.listeners = true
      }

      notify(notifyOptions)
    },
  }

  observer.setOptions(observerOptions)

  return observer

  function willFetchOptionally(): boolean {
    return observer.options.enabled !== false && isStale()
  }

  function isStale(): boolean {
    return currentQuery.isStaleByTime(observer.options.staleTime)
  }

  function optionalFetch(): void {
    if (willFetchOptionally()) {
      executeFetch()
    }
  }

  function executeFetch(
    fetchOptions?: ObserverFetchOptions
  ): Promise<TQueryData | undefined> {
    // Make sure we reference the latest query as the current one might have been removed
    updateQuery()

    // Fetch
    let promise: Promise<TQueryData | undefined> = currentQuery.fetch(
      observer.options as QueryOptions<TQueryFnData, TError, TQueryData>,
      fetchOptions
    )

    if (!fetchOptions?.throwOnError) {
      promise = promise.catch(noop)
    }

    return promise
  }

  function updateStaleTimeout(): void {
    clearStaleTimeout()

    if (
      isServer ||
      currentResult.isStale ||
      !isValidTimeout(observer.options.staleTime)
    ) {
      return
    }

    const time = timeUntilStale(
      currentResult.dataUpdatedAt,
      observer.options.staleTime
    )

    // The timeout is sometimes triggered 1 ms before the stale time expiration.
    // To mitigate this issue we always add 1 ms to the timeout.
    const timeout = time + 1

    staleTimeoutId = setTimeout(() => {
      if (!currentResult.isStale) {
        const prevResult = currentResult
        updateResult()
        notify({
          listeners: shouldNotifyListeners(prevResult, currentResult),
          cache: true,
        })
      }
    }, timeout)
  }

  function updateRefetchInterval(): void {
    clearRefetchInterval()

    if (
      isServer ||
      observer.options.enabled === false ||
      !isValidTimeout(observer.options.refetchInterval)
    ) {
      return
    }

    refetchIntervalId = setInterval(() => {
      if (
        observer.options.refetchIntervalInBackground ||
        focusManager.isFocused()
      ) {
        executeFetch()
      }
    }, observer.options.refetchInterval)
  }

  function updateTimers(): void {
    updateStaleTimeout()
    updateRefetchInterval()
  }

  function clearTimers(): void {
    clearStaleTimeout()
    clearRefetchInterval()
  }

  function clearStaleTimeout(): void {
    clearTimeout(staleTimeoutId)
    staleTimeoutId = undefined
  }

  function clearRefetchInterval(): void {
    clearInterval(refetchIntervalId)
    refetchIntervalId = undefined
  }

  function shouldNotifyListeners(
    prevResult: QueryObserverResult,
    result: QueryObserverResult
  ): boolean {
    const {
      notifyOnChangeProps,
      notifyOnChangePropsExclusions,
    } = observer.options

    if (prevResult === result) {
      return false
    }

    if (!notifyOnChangeProps && !notifyOnChangePropsExclusions) {
      return true
    }

    const keys = Object.keys(result)

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as keyof QueryObserverResult
      const changed = prevResult[key] !== result[key]
      const isIncluded = notifyOnChangeProps?.some(x => x === key)
      const isExcluded = notifyOnChangePropsExclusions?.some(x => x === key)

      if (changed) {
        if (notifyOnChangePropsExclusions && isExcluded) {
          continue
        }

        if (!notifyOnChangeProps || isIncluded) {
          return true
        }
      }
    }

    return false
  }

  function updateResult(willFetch?: boolean): void {
    const result = observer.getNewResult(willFetch)

    // Keep reference to the current state on which the current result is based on
    currentResultState = currentQuery.state

    // Only update if something has changed
    if (!shallowEqualObjects(result, currentResult)) {
      currentResult = result
    }
  }

  function updateQuery(): void {
    const prevQuery = currentQuery

    const query = client
      .getQueryCache()
      .build(
        client,
        observer.options as QueryOptions<TQueryFnData, TError, TQueryData>
      )

    if (query === prevQuery) {
      return
    }

    previousQueryResult = currentResult
    currentQuery = query
    initialDataUpdateCount = query.state.dataUpdateCount
    initialErrorUpdateCount = query.state.errorUpdateCount

    const willFetch = prevQuery
      ? willFetchOptionally()
      : observer.willFetchOnMount()

    updateResult(willFetch)

    if (!subscribable.hasListeners()) {
      return
    }

    prevQuery?.removeObserver(observer)
    currentQuery.addObserver(observer)

    if (shouldNotifyListeners(previousQueryResult, currentResult)) {
      notify({ listeners: true })
    }
  }

  function notify(notifyOptions: NotifyOptions): void {
    notifyManager.batch(() => {
      // First trigger the configuration callbacks
      if (notifyOptions.onSuccess) {
        observer.options.onSuccess?.(currentResult.data!)
        observer.options.onSettled?.(currentResult.data!, null)
      } else if (notifyOptions.onError) {
        observer.options.onError?.(currentResult.error!)
        observer.options.onSettled?.(undefined, currentResult.error!)
      }

      // Then trigger the listeners
      if (notifyOptions.listeners) {
        subscribable.listeners.forEach(listener => {
          listener(currentResult)
        })
      }

      // Then the cache listeners
      if (notifyOptions.cache) {
        client.getQueryCache().notify(currentQuery)
      }
    })
  }
}
