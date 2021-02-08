import {
  Updater,
  ensureArray,
  functionalUpdate,
  isValidTimeout,
  noop,
  replaceEqualDeep,
  timeUntilStale,
} from './utils'
import type {
  InitialDataFunction,
  QueryKey,
  QueryOptions,
  QueryStatus,
  QueryFunctionContext,
} from './types'
import type { QueryCache } from './queryCache'
import type { QueryObserver } from './queryObserver'
import { notifyManager } from './notifyManager'
import { getLogger } from './logger'
import {
  createRetryer,
  CancelOptions,
  isCancelledError,
  Retryer,
} from './retryer'

// TYPES

interface QueryConfig<TQueryFnData, TError, TData> {
  cache: QueryCache
  queryKey: QueryKey
  queryHash: string
  options?: QueryOptions<TQueryFnData, TError, TData>
  defaultOptions?: QueryOptions<TQueryFnData, TError, TData>
  state?: QueryState<TData, TError>
}

export interface QueryState<TData = unknown, TError = unknown> {
  data?: TData
  dataUpdateCount: number
  dataUpdatedAt: number
  error: TError | null
  errorUpdateCount: number
  errorUpdatedAt: number
  fetchFailureCount: number
  fetchMeta: any
  isFetching: boolean
  isInvalidated: boolean
  isPaused: boolean
  status: QueryStatus
}

export interface FetchContext<TQueryFnData, TError, TData> {
  fetchFn: () => unknown | Promise<unknown>
  fetchOptions?: FetchOptions
  options: QueryOptions<TQueryFnData, TError, TData>
  queryKey: QueryKey
  state: QueryState<TData, TError>
}

export interface QueryBehavior<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData
> {
  onFetch: (context: FetchContext<TQueryFnData, TError, TData>) => void
}

export interface FetchOptions {
  cancelRefetch?: boolean
  meta?: any
}

export interface SetDataOptions {
  updatedAt?: number
}

interface FailedAction {
  type: 'failed'
}

interface FetchAction {
  type: 'fetch'
  meta?: any
}

interface SuccessAction<TData> {
  data: TData | undefined
  type: 'success'
  dataUpdatedAt?: number
}

interface ErrorAction<TError> {
  type: 'error'
  error: TError
}

interface InvalidateAction {
  type: 'invalidate'
}

interface PauseAction {
  type: 'pause'
}

interface ContinueAction {
  type: 'continue'
}

interface SetStateAction<TData, TError> {
  type: 'setState'
  state: QueryState<TData, TError>
}

export type Action<TData, TError> =
  | ContinueAction
  | ErrorAction<TError>
  | FailedAction
  | FetchAction
  | InvalidateAction
  | PauseAction
  | SetStateAction<TData, TError>
  | SuccessAction<TData>

export type Query<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData
> = {
  queryKey: QueryKey
  queryHash: string
  options: QueryOptions<TQueryFnData, TError, TData>
  initialState: QueryState<TData, TError>
  state: QueryState<TData, TError>
  cacheTime?: number
  setDefaultOptions(
    newDefaultOptions: QueryOptions<TQueryFnData, TError, TData>
  ): void
  setData(
    updater: Updater<TData | undefined, TData>,
    options?: SetDataOptions
  ): TData
  setState(state: QueryState<TData, TError>): void
  cancel(options?: CancelOptions): Promise<void>
  destroy(): void
  reset(): void
  isActive(): boolean
  isFetching(): boolean
  isStale(): boolean
  isStaleByTime(staleTime?: number): boolean
  onFocus(): void
  onOnline(): void
  addObserver(observer: QueryObserver<any, any, any, any>): void
  removeObserver(observer: QueryObserver<any, any, any, any>): void
  invalidate(): void
  fetch(
    options?: QueryOptions<TQueryFnData, TError, TData>,
    fetchOptions?: FetchOptions
  ): Promise<TData>
}

export function createQuery<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData
>(config: QueryConfig<TQueryFnData, TError, TData>) {
  const cache: QueryCache = config.cache
  let promise: Promise<TData>
  let gcTimeout: number | undefined
  let retryer: Retryer<TData, TError>
  let observers: QueryObserver<any, any, any, any>[] = []
  let defaultOptions: QueryOptions<TQueryFnData, TError, TData> | undefined =
    config.defaultOptions

  const options = { ...defaultOptions, ...config.options }
  const initialState = config.state || getDefaultState(options)

  const query: Query<TQueryFnData, TError, TData> = {
    queryKey: config.queryKey,
    queryHash: config.queryHash,
    options,
    initialState,
    state: initialState,
    cacheTime: undefined,
    setDefaultOptions: newDefaultOptions => {
      defaultOptions = newDefaultOptions
    },
    setData: (updater, setDataOptions) => {
      const prevData = query.state.data

      // Get the new data
      let data = functionalUpdate(updater, prevData)

      // Use prev data if an isDataEqual function is defined and returns `true`
      if (query.options.isDataEqual?.(prevData, data)) {
        data = prevData as TData
      } else if (query.options.structuralSharing !== false) {
        // Structurally share data between prev and new data if needed
        data = replaceEqualDeep(prevData, data)
      }

      // Set data and mark it as cached
      dispatch({
        data,
        type: 'success',
        dataUpdatedAt: setDataOptions?.updatedAt,
      })

      return data
    },
    setState: state => {
      dispatch({ type: 'setState', state })
    },

    cancel: cancelOptions => {
      retryer?.cancel(cancelOptions)
      return promise ? promise.then(noop).catch(noop) : Promise.resolve()
    },

    destroy: () => {
      clearGcTimeout()
      query.cancel({ silent: true })
    },

    reset: () => {
      query.destroy()
      query.setState(initialState)
    },

    isActive: () => {
      return observers.some(observer => observer.options.enabled !== false)
    },

    isFetching: () => {
      return query.state.isFetching
    },

    isStale: () => {
      return (
        query.state.isInvalidated ||
        !query.state.dataUpdatedAt ||
        observers.some(observer => observer.getCurrentResult().isStale)
      )
    },

    isStaleByTime: staleTime => {
      return (
        query.state.isInvalidated ||
        !query.state.dataUpdatedAt ||
        !timeUntilStale(query.state.dataUpdatedAt, staleTime)
      )
    },

    onFocus: () => {
      const observer = observers.find(x => x.willFetchOnWindowFocus())

      if (observer) {
        observer.refetch()
      }

      // Continue fetch if currently paused
      retryer?.proceed()
    },

    onOnline: () => {
      const observer = observers.find(x => x.willFetchOnReconnect())

      if (observer) {
        observer.refetch()
      }

      // Continue fetch if currently paused
      retryer?.proceed()
    },

    addObserver: observer => {
      if (observers.indexOf(observer) === -1) {
        observers.push(observer)

        // Stop the query from being garbage collected
        clearGcTimeout()

        cache.notify(query)
      }
    },

    removeObserver: observer => {
      if (observers.indexOf(observer) !== -1) {
        observers = observers.filter(x => x !== observer)

        if (!observers.length) {
          // If the transport layer does not support cancellation
          // we'll let the query continue so the result can be cached
          if (retryer) {
            if (retryer.isTransportCancelable) {
              retryer.cancel()
            } else {
              retryer.cancelRetry()
            }
          }

          if (query.cacheTime) {
            scheduleGc()
          } else {
            cache.remove(query)
          }
        }

        cache.notify(query)
      }
    },

    invalidate: () => {
      if (!query.state.isInvalidated) {
        dispatch({ type: 'invalidate' })
      }
    },

    fetch: (newOptions, fetchOptions) => {
      if (query.state.isFetching)
        if (query.state.dataUpdatedAt && fetchOptions?.cancelRefetch) {
          // Silently cancel current fetch if the user wants to cancel refetches
          query.cancel({ silent: true })
        } else if (promise) {
          // Return current promise if we are already fetching
          return promise
        }

      // Update config if passed, otherwise the config from the last execution is used
      if (options) {
        setOptions(newOptions)
      }

      // Use the options from the first observer with a query function if no function is found.
      // This can happen when the query is hydrated or created with setQueryData.
      if (!options.queryFn) {
        const observer = observers.find(x => x.options.queryFn)
        if (observer) {
          setOptions(observer.options)
        }
      }

      // Create query function context
      const arrayQueryKey = ensureArray(query.queryKey)
      const queryFnContext: QueryFunctionContext = {
        queryKey: arrayQueryKey,
        pageParam: undefined,
      }

      // Create fetch function
      const fetchFn = () =>
        options.queryFn
          ? options.queryFn(queryFnContext)
          : Promise.reject('Missing queryFn')

      // Trigger behavior hook
      const context: FetchContext<TQueryFnData, TError, TData> = {
        fetchOptions,
        options: options,
        queryKey: arrayQueryKey,
        state: query.state,
        fetchFn,
      }

      if (options.behavior?.onFetch) {
        options.behavior?.onFetch(context)
      }

      // Set to fetching state if not already in it
      if (
        !query.state.isFetching ||
        query.state.fetchMeta !== context.fetchOptions?.meta
      ) {
        dispatch({ type: 'fetch', meta: context.fetchOptions?.meta })
      }

      // Try to fetch the data
      retryer = createRetryer({
        fn: context.fetchFn as () => TData,
        onSuccess: data => {
          query.setData(data as TData)
          // Remove query after fetching if cache time is 0
          if (query.cacheTime === 0) {
            optionalRemove()
          }
        },
        onError: error => {
          // Optimistically update state if needed
          if (!(isCancelledError(error) && error.silent)) {
            dispatch({
              type: 'error',
              error: error as TError,
            })
          }

          if (!isCancelledError(error)) {
            // Notify cache callback
            if (cache.config?.onError) {
              cache.config.onError(error, query as Query)
            }
            // Log error
            getLogger().error(error)
          }
          // Remove query after fetching if cache time is 0
          if (query.cacheTime === 0) {
            optionalRemove()
          }
        },
        onFail: () => {
          dispatch({ type: 'failed' })
        },
        onPause: () => {
          dispatch({ type: 'pause' })
        },
        onContinue: () => {
          dispatch({ type: 'continue' })
        },
        retry: context.options.retry,
        retryDelay: context.options.retryDelay,
      })

      promise = retryer.promise

      return promise
    },
  }

  setOptions(config.options)
  scheduleGc()

  return query

  function setOptions(
    newOptions?: QueryOptions<TQueryFnData, TError, TData>
  ): void {
    query.options = { ...defaultOptions, ...newOptions }

    // Default to 5 minutes if not cache time is set
    query.cacheTime = Math.max(
      query.cacheTime || 0,
      query.options.cacheTime ?? 5 * 60 * 1000
    )
  }

  function scheduleGc(): void {
    clearGcTimeout()

    if (isValidTimeout(query.cacheTime)) {
      gcTimeout = setTimeout(() => {
        optionalRemove()
      }, query.cacheTime)
    }
  }

  function clearGcTimeout() {
    clearTimeout(gcTimeout)
    gcTimeout = undefined
  }

  function optionalRemove() {
    if (!observers.length && !query.state.isFetching) {
      cache.remove(query)
    }
  }

  function dispatch(action: Action<TData, TError>): void {
    query.state = reducer(query.state, action)

    notifyManager.batch(() => {
      observers.forEach(observer => {
        observer.onQueryUpdate(action)
      })

      cache.notify(query)
    })
  }

  function getDefaultState(
    defaultStateOptions: QueryOptions<TQueryFnData, TError, TData>
  ): QueryState<TData, TError> {
    const data =
      typeof defaultStateOptions.initialData === 'function'
        ? (defaultStateOptions.initialData as InitialDataFunction<TData>)()
        : defaultStateOptions.initialData

    const hasInitialData =
      typeof defaultStateOptions.initialData !== 'undefined'

    const initialDataUpdatedAt = hasInitialData
      ? typeof defaultStateOptions.initialDataUpdatedAt === 'function'
        ? (defaultStateOptions.initialDataUpdatedAt as () =>
            | number
            | undefined)()
        : defaultStateOptions.initialDataUpdatedAt
      : 0

    const hasData = typeof data !== 'undefined'

    return {
      data,
      dataUpdateCount: 0,
      dataUpdatedAt: hasData ? initialDataUpdatedAt ?? Date.now() : 0,
      error: null,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      fetchFailureCount: 0,
      fetchMeta: null,
      isFetching: false,
      isInvalidated: false,
      isPaused: false,
      status: hasData ? 'success' : 'idle',
    }
  }

  // protected
  function reducer(
    state: QueryState<TData, TError>,
    action: Action<TData, TError>
  ): QueryState<TData, TError> {
    switch (action.type) {
      case 'failed':
        return {
          ...state,
          fetchFailureCount: state.fetchFailureCount + 1,
        }
      case 'pause':
        return {
          ...state,
          isPaused: true,
        }
      case 'continue':
        return {
          ...state,
          isPaused: false,
        }
      case 'fetch':
        return {
          ...state,
          fetchFailureCount: 0,
          fetchMeta: action.meta ?? null,
          isFetching: true,
          isPaused: false,
          status: !state.dataUpdatedAt ? 'loading' : state.status,
        }
      case 'success':
        return {
          ...state,
          data: action.data,
          dataUpdateCount: state.dataUpdateCount + 1,
          dataUpdatedAt: action.dataUpdatedAt ?? Date.now(),
          error: null,
          fetchFailureCount: 0,
          isFetching: false,
          isInvalidated: false,
          isPaused: false,
          status: 'success',
        }
      case 'error':
        const error = action.error as unknown

        if (isCancelledError(error) && error.revert) {
          let previousStatus: QueryStatus

          if (!state.dataUpdatedAt && !state.errorUpdatedAt) {
            previousStatus = 'idle'
          } else if (state.dataUpdatedAt > state.errorUpdatedAt) {
            previousStatus = 'success'
          } else {
            previousStatus = 'error'
          }

          return {
            ...state,
            fetchFailureCount: 0,
            isFetching: false,
            isPaused: false,
            status: previousStatus,
          }
        }

        return {
          ...state,
          error: error as TError,
          errorUpdateCount: state.errorUpdateCount + 1,
          errorUpdatedAt: Date.now(),
          fetchFailureCount: state.fetchFailureCount + 1,
          isFetching: false,
          isPaused: false,
          status: 'error',
        }
      case 'invalidate':
        return {
          ...state,
          isInvalidated: true,
        }
      case 'setState':
        return {
          ...state,
          ...action.state,
        }
      default:
        return state
    }
  }
}
