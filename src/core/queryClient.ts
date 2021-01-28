import {
  QueryFilters,
  Updater,
  hashQueryKey,
  noop,
  partialMatchKey,
} from './utils'
import type {
  DefaultQueryClientOptions,
  FetchInfiniteQueryOptions,
  FetchQueryOptions,
  InfiniteQueryResult,
  InvalidateOptions,
  InvalidateQueryFilters,
  MutationKey,
  MutationObserverOptions,
  MutationOptions,
  QueryKey,
  QueryObserverOptions,
  QueryOptions,
  RefetchOptions,
  ResetOptions,
} from './types'
import type { QueryState, SetDataOptions } from './query'
import { createMutationCache, MutationCache } from './mutationCache'
import { focusManager } from './focusManager'
import { onlineManager } from './onlineManager'
import { notifyManager } from './notifyManager'
import { CancelOptions } from './retryer'
import { infiniteQueryBehavior } from './infiniteQueryBehavior'
import { createQueryCache, QueryCache } from './queryCache'

// TYPES

interface QueryClientConfig {
  queryCache?: QueryCache
  mutationCache?: MutationCache
  defaultOptions?: DefaultQueryClientOptions
}

interface QueryDefaults {
  queryKey: QueryKey
  defaultOptions: QueryOptions<any, any, any>
}

interface MutationDefaults {
  mutationKey: MutationKey
  defaultOptions: MutationOptions<any, any, any, any>
}

export type QueryClient = {
  mount(): void
  unmount(): void
  isFetching(filters?: QueryFilters): number
  getQueryData<TData = unknown>(filters?: QueryFilters): TData | undefined
  setQueryData<TData>(
    queryKey: QueryKey,
    updater: Updater<TData | undefined, TData>,
    options?: SetDataOptions
  ): TData
  getQueryState<TData = unknown, TError = undefined>(
    filters?: QueryFilters
  ): QueryState<TData, TError> | undefined
  removeQueries(filters?: QueryFilters): void
  resetQueries(filters?: QueryFilters, options?: ResetOptions): Promise<void>
  cancelQueries(filters?: QueryFilters, options?: CancelOptions): Promise<void>
  invalidateQueries(
    filters?: InvalidateQueryFilters,
    options?: InvalidateOptions
  ): Promise<void>
  refetchQueries(
    filters?: QueryFilters,
    options?: RefetchOptions
  ): Promise<void>
  fetchQuery<TQueryFnData = unknown, TError = unknown, TData = TQueryFnData>(
    options: FetchQueryOptions<TQueryFnData, TError, TData>
  ): Promise<TData | undefined>
  prefetchQuery(options: FetchQueryOptions): Promise<void>
  fetchInfiniteQuery<
    TQueryFnData = unknown,
    TError = unknown,
    TData = TQueryFnData
  >(
    options: FetchInfiniteQueryOptions<TQueryFnData, TError, TData>
  ): Promise<InfiniteQueryResult<TData> | undefined>
  prefetchInfiniteQuery(options: FetchInfiniteQueryOptions): Promise<void>
  cancelMutations(): Promise<void>
  resumePausedMutations(): Promise<void>
  executeMutation<
    TData = unknown,
    TError = unknown,
    TVariables = void,
    TContext = unknown
  >(
    options: MutationOptions<TData, TError, TVariables, TContext>
  ): Promisable<TGenerics['Data']>
  getQueryCache(): QueryCache
  getMutationCache(): MutationCache
  getDefaultOptions(): DefaultQueryClientOptions
  setDefaultOptions(options: DefaultQueryClientOptions): void
  setQueryDefaults(
    queryKey: QueryKey,
    options: QueryObserverOptions<any, any, any, any>
  ): void
  getQueryDefaults(
    queryKey?: QueryKey
  ): QueryObserverOptions<any, any, any, any> | undefined
  setMutationDefaults(
    mutationKey: MutationKey,
    options: MutationObserverOptions<any, any, any, any>
  ): void
  getMutationDefaults(
    mutationKey?: MutationKey
  ): MutationObserverOptions<any, any, any, any> | undefined
  defaultQueryOptions<T extends QueryOptions<any, any, any>>(options?: T): T
  defaultQueryObserverOptions<
    T extends QueryObserverOptions<any, any, any, any>
  >(
    options?: T
  ): T
  defaultMutationOptions<T extends MutationOptions<any, any, any, any>>(
    options?: T
  ): T
  clear(): void
}

export function createQueryClient(config: QueryClientConfig = {}) {
  const queryCache = config.queryCache || createQueryCache()
  const mutationCache = config.mutationCache || createMutationCache()
  let defaultOptions = config.defaultOptions || {}
  const queryDefaults: QueryDefaults[] = []
  const mutationDefaults: MutationDefaults[] = []
  let unsubscribeFocus: () => void
  let unsubscribeOnline: () => void

  const queryClient: QueryClient = {
    mount: () => {
      unsubscribeFocus = focusManager.subscribe(() => {
        if (focusManager.isFocused() && onlineManager.isOnline()) {
          mutationCache.onFocus()
          queryCache.onFocus()
        }
      })
      unsubscribeOnline = onlineManager.subscribe(() => {
        if (focusManager.isFocused() && onlineManager.isOnline()) {
          mutationCache.onOnline()
          queryCache.onOnline()
        }
      })
    },
    unmount: () => {
      unsubscribeFocus?.()
      unsubscribeOnline?.()
    },
    isFetching: (filters = {}) => {
      filters.fetching = true
      return queryCache.findAll(filters).length
    },
    getQueryData: <TData = unknown>(
      filters?: QueryFilters
    ): TData | undefined => {
      return queryCache.find<TData>(filters)?.state.data
    },
    setQueryData: <TData>(
      queryKey: QueryKey,
      updater: Updater<TData | undefined, TData>,
      options?: SetDataOptions
    ): TData => {
      const defaultedOptions = queryClient.defaultQueryOptions({ queryKey })
      return queryCache
        .build<TData, unknown, TData>(queryClient, defaultedOptions)
        .setData(updater, options)
    },
    getQueryState: <TData = unknown, TError = undefined>(
      filters?: QueryFilters
    ): QueryState<TData, TError> | undefined =>
      queryCache.find<TData, TError>(filters)?.state,
    removeQueries: filters => {
      notifyManager.batch(() => {
        queryCache.findAll(filters).forEach(query => {
          queryCache.remove(query)
        })
      })
    },
    resetQueries: (filters, resetOptions) => {
      const refetchFilters: QueryFilters = {
        ...filters,
        active: true,
      }

      return notifyManager.batch(() => {
        queryCache.findAll(filters).forEach(query => {
          query.reset()
        })
        return queryClient.refetchQueries(refetchFilters, resetOptions)
      })
    },
    cancelQueries: (filters, cancelOptions = {}) => {
      if (typeof cancelOptions.revert === 'undefined') {
        cancelOptions.revert = true
      }

      const promises = notifyManager.batch(() =>
        queryCache.findAll(filters).map(query => query.cancel(cancelOptions))
      )

      return Promise.all(promises).then(noop).catch(noop)
    },
    invalidateQueries: (filters = {}, options) => {
      const refetchFilters: QueryFilters = {
        ...filters,
        active: filters.refetchActive ?? true,
        inactive: filters.refetchInactive ?? false,
      }

      return notifyManager.batch(() => {
        queryCache.findAll(filters).forEach(query => {
          query.invalidate()
        })
        return queryClient.refetchQueries(refetchFilters, options)
      })
    },
    refetchQueries: (filters, options) => {
      const promises = notifyManager.batch(() =>
        queryCache.findAll(filters).map(query => query.fetch())
      )

      let promise = Promise.all(promises).then(noop)

      if (!options?.throwOnError) {
        promise = promise.catch(noop)
      }

      return promise
    },
    fetchQuery: <
      TQueryFnData = unknown,
      TError = unknown,
      TData = TQueryFnData
    >(
      options: FetchQueryOptions<TQueryFnData, TError, TData>
    ): Promise<TData | undefined> => {
      const defaultedOptions = queryClient.defaultQueryOptions(options)

      // https://github.com/tannerlinsley/react-query/issues/652
      if (typeof defaultedOptions.retry === 'undefined') {
        defaultedOptions.retry = false
      }

      const query = queryCache.build<TQueryFnData, TError, TData>(
        queryClient,
        defaultedOptions
      )

      return query.isStaleByTime(defaultedOptions.staleTime)
        ? query.fetch(defaultedOptions)
        : Promise.resolve(query.state.data)
    },
    prefetchQuery: options =>
      queryClient.fetchQuery(options).then(noop).catch(noop),
    fetchInfiniteQuery: <
      TQueryFnData = unknown,
      TError = unknown,
      TData = TQueryFnData
    >(
      options: FetchInfiniteQueryOptions<TQueryFnData, TError, TData>
    ): Promise<InfiniteQueryResult<TData> | undefined> => {
      options.behavior = infiniteQueryBehavior<TQueryFnData, TError, TData>()
      return queryClient.fetchQuery(options)
    },
    prefetchInfiniteQuery: options => {
      return queryClient.fetchInfiniteQuery(options).then(noop).catch(noop)
    },
    cancelMutations: () => {
      const promises = notifyManager.batch(() =>
        mutationCache.getAll().map(mutation => mutation.cancel())
      )
      return Promise.all(promises).then(noop).catch(noop)
    },
    resumePausedMutations: () => {
      return queryClient.getMutationCache().resumePausedMutations()
    },
    executeMutation: options => {
      return mutationCache.build(queryClient, options).execute()
    },
    getQueryCache: () => queryCache,
    getMutationCache: () => mutationCache,
    getDefaultOptions: () => defaultOptions,
    setDefaultOptions: options => {
      defaultOptions = options
    },
    setQueryDefaults: (queryKey, options) => {
      const result = queryDefaults.find(
        x => hashQueryKey(queryKey) === hashQueryKey(x.queryKey)
      )
      if (result) {
        result.defaultOptions = options
      } else {
        queryDefaults.push({ queryKey, defaultOptions: options })
      }
    },
    getQueryDefaults: queryKey => {
      return queryKey
        ? queryDefaults.find(x => partialMatchKey(queryKey, x.queryKey))
            ?.defaultOptions
        : undefined
    },
    setMutationDefaults: (mutationKey, options) => {
      const result = mutationDefaults.find(
        x => hashQueryKey(mutationKey) === hashQueryKey(x.mutationKey)
      )
      if (result) {
        result.defaultOptions = options
      } else {
        mutationDefaults.push({ mutationKey, defaultOptions: options })
      }
    },
    getMutationDefaults: mutationKey => {
      return mutationKey
        ? mutationDefaults.find(x =>
            partialMatchKey(mutationKey, x.mutationKey)
          )?.defaultOptions
        : undefined
    },
    defaultQueryOptions: <T extends QueryOptions<any, any, any>>(
      options?: T
    ) => {
      if (options?._defaulted) {
        return options
      }
      return {
        ...defaultOptions.queries,
        ...queryClient.getQueryDefaults(options?.queryKey),
        ...options,
        _defaulted: true,
      } as T
    },
    defaultQueryObserverOptions: options => {
      return queryClient.defaultQueryOptions(options)
    },
    defaultMutationOptions: <T extends MutationOptions<any, any, any, any>>(
      options?: T
    ) => {
      if (options?._defaulted) {
        return options
      }

      return {
        ...defaultOptions.mutations,
        ...queryClient.getMutationDefaults(options?.mutationKey),
        ...options,
        _defaulted: true,
      } as T
    },
    clear: () => {
      queryCache.clear()
      mutationCache.clear()
    },
  }

  return queryClient
}
