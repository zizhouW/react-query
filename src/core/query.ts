import {
  Updater,
  ensureArray,
  functionalUpdate,
  isValidTimeout,
  noop,
  replaceEqualDeep,
  timeUntilStale,
} from './utils'
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
import {
  InitialDataFunction,
  QueryFunctionContext,
  QueryGenerics,
  QueryOptions,
  QueryStatus,
  ResolvedQueryGenerics,
} from './types'

// TYPES

interface QueryConfig<TGenerics extends QueryGenerics> {
  cache: QueryCache
  queryHash: string
  queryKey: TGenerics['QueryKey']
  options: QueryOptions<TGenerics>
  defaultOptions?: QueryOptions<TGenerics>
  state?: QueryState<TGenerics>
}

export interface QueryState<
  TGenerics extends QueryGenerics,
  TResolvedGenerics extends ResolvedQueryGenerics<
    TGenerics
  > = ResolvedQueryGenerics<TGenerics>
> {
  data?: TResolvedGenerics['QueryData']
  dataUpdateCount: number
  dataUpdatedAt: number
  error: TGenerics['Data'] | null
  errorUpdateCount: number
  errorUpdatedAt: number
  fetchFailureCount: number
  fetchMeta: any
  isFetching: boolean
  isInvalidated: boolean
  isPaused: boolean
  status: QueryStatus
}

export interface FetchContext<TGenerics extends QueryGenerics> {
  fetchFn: () => unknown | Promise<unknown>
  fetchOptions?: FetchOptions
  queryKey: TGenerics['QueryKey']
  options: QueryOptions<TGenerics>
  state: QueryState<TGenerics>
}

export interface QueryBehavior<TGenerics extends QueryGenerics> {
  onFetch: (context: FetchContext<TGenerics>) => void
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

interface SetStateAction<TGenerics extends QueryGenerics> {
  type: 'setState'
  state: QueryState<TGenerics>
}

export type Action<TGenerics extends QueryGenerics> =
  | ContinueAction
  | ErrorAction<TGenerics['Error']>
  | FailedAction
  | FetchAction
  | InvalidateAction
  | PauseAction
  | SetStateAction<TGenerics>
  | SuccessAction<TGenerics['Data']>

export type Query<TGenerics extends QueryGenerics> = {
  queryHash: string
  queryKey: TGenerics['QueryKey']
  options: QueryOptions<TGenerics>
  initialState: QueryState<TGenerics>
  state: QueryState<TGenerics>
  cacheTime?: number
  setDefaultOptions(newDefaultOptions: QueryOptions<TGenerics>): void
  setData(
    updater: Updater<TGenerics['Data'] | undefined, TGenerics['Data']>,
    options?: SetDataOptions
  ): TGenerics['Data']
  setState(state: QueryState<TGenerics>): void
  cancel(options?: CancelOptions): Promise<void>
  destroy(): void
  reset(): void
  isActive(): boolean
  isFetching(): boolean
  isStale(): boolean
  isStaleByTime(staleTime?: number): boolean
  onFocus(): void
  onOnline(): void
  addObserver(observer: QueryObserver<TGenerics>): void
  removeObserver(observer: QueryObserver<TGenerics>): void
  invalidate(): void
  fetch(
    options?: QueryOptions<TGenerics>,
    fetchOptions?: FetchOptions
  ): Promise<TGenerics['Data']>
}

export function createQuery<TGenerics extends QueryGenerics>(
  config: QueryConfig<TGenerics>
) {
  const cache: QueryCache = config.cache
  let promise: Promise<TGenerics['Data']>
  let gcTimeout: number | undefined
  let retryer: Retryer<TGenerics>
  let observers: QueryObserver<TGenerics>[] = []
  let defaultOptions: QueryOptions<TGenerics> | undefined =
    config.defaultOptions

  const options: QueryOptions<TGenerics> = {
    ...defaultOptions,
    ...config.options,
  }
  const initialState = config.state || getDefaultState(options)

  const query: Query<TGenerics> = {
    queryHash: config.queryHash,
    queryKey: config.queryKey,
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
        data = prevData
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
      const queryFnContext: QueryFunctionContext<TGenerics> = {
        queryKey: arrayQueryKey,
        pageParam: undefined,
      }

      // Create fetch function
      const fetchFn = () =>
        options.queryFn
          ? options.queryFn(queryFnContext)
          : Promise.reject('Missing queryFn')

      // Trigger behavior hook
      const context: FetchContext<TGenerics> = {
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
        fn: context.fetchFn as () => TGenerics['Data'],
        onSuccess: data => {
          query.setData(data as TGenerics['Data'])
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
              error: error as TGenerics['Error'],
            })
          }

          if (!isCancelledError(error)) {
            // Notify cache callback
            if (cache.config?.onError) {
              cache.config.onError(error, query)
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

  function setOptions(newOptions?: QueryOptions<any>): void {
    query.options = { ...newOptions }

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

  function dispatch(action: Action<TGenerics>): void {
    query.state = reducer(query.state, action)

    notifyManager.batch(() => {
      observers.forEach(observer => {
        observer.onQueryUpdate(action)
      })

      cache.notify(query)
    })
  }

  function getDefaultState(
    defaultStateOptions: QueryOptions<TGenerics> | undefined
  ): QueryState<TGenerics> {
    const data =
      typeof defaultStateOptions?.initialData === 'function'
        ? (defaultStateOptions?.initialData as InitialDataFunction<TGenerics>)()
        : defaultStateOptions?.initialData

    const hasInitialData =
      typeof defaultStateOptions?.initialData !== 'undefined'

    const initialDataUpdatedAt = hasInitialData
      ? typeof defaultStateOptions?.initialDataUpdatedAt === 'function'
        ? (defaultStateOptions?.initialDataUpdatedAt as () =>
            | number
            | undefined)()
        : defaultStateOptions?.initialDataUpdatedAt
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
    state: QueryState<TGenerics>,
    action: Action<TGenerics>
  ): QueryState<TGenerics> {
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
          error: error as TGenerics['Error'],
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
