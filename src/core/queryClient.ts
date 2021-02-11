import {
  QueryFilters,
  Updater,
  hashQueryKey,
  noop,
  partialMatchKey,
} from './utils'
import type {
  DefaultQueryClientOptions,
  FetchQueryOptions,
  InfiniteQueryResult,
  InvalidateOptions,
  InvalidateQueryFilters,
  MutationGenerics,
  MutationKey,
  MutationObserverOptions,
  MutationOptions,
  QueryGenerics,
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
  defaultOptions: QueryOptions<any>
}

interface MutationDefaults {
  mutationKey: MutationKey
  defaultOptions: MutationOptions
}

export type QueryClient = {
  mount(): void
  unmount(): void
  isFetching(filters?: QueryFilters): number
  getQueryData<TGenerics extends QueryGenerics>(
    filters?: QueryFilters
  ): TGenerics['Data'] | undefined
  setQueryData<TGenerics extends QueryGenerics>(
    queryKey: TGenerics['QueryKey'],
    updater: Updater<TGenerics['Data'] | undefined, TGenerics['Data']>,
    options?: SetDataOptions
  ): TGenerics['Data']
  getQueryState<TGenerics extends QueryGenerics>(
    filters?: QueryFilters
  ): QueryState<TGenerics> | undefined
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
  fetchQuery<TGenerics extends QueryGenerics>(
    options: FetchQueryOptions<TGenerics>
  ): Promise<TGenerics['Data'] | undefined>
  prefetchQuery<TGenerics extends QueryGenerics>(
    options: FetchQueryOptions<TGenerics>
  ): Promise<void>
  fetchInfiniteQuery<TGenerics extends QueryGenerics>(
    options: FetchQueryOptions<TGenerics>
  ): Promise<InfiniteQueryResult<TGenerics> | undefined>
  prefetchInfiniteQuery<TGenerics extends QueryGenerics>(
    options: FetchQueryOptions<TGenerics>
  ): Promise<void>
  cancelMutations(): Promise<void>
  resumePausedMutations(): Promise<void>
  executeMutation<TGenerics extends MutationGenerics>(
    options: MutationOptions<MutationGenerics>
  ): Promise<TGenerics['Data']>
  getQueryCache(): QueryCache
  getMutationCache(): MutationCache
  getDefaultOptions(): DefaultQueryClientOptions
  setDefaultOptions(options: DefaultQueryClientOptions): void
  setQueryDefaults(queryKey: QueryKey, options: QueryObserverOptions<any>): void
  getQueryDefaults<TGenerics extends QueryGenerics>(
    queryKey?: QueryKey
  ): QueryObserverOptions<TGenerics> | undefined
  setMutationDefaults(
    mutationKey: MutationKey,
    options: MutationObserverOptions<any>
  ): void
  getMutationDefaults<TGenerics extends MutationGenerics>(
    queryKey?: MutationKey
  ): MutationObserverOptions<TGenerics> | undefined
  defaultQueryOptions<TGenerics extends QueryGenerics>(
    options?: QueryOptions<TGenerics>
  ): FetchQueryOptions<TGenerics>
  defaultQueryObserverOptions<TGenerics extends QueryGenerics>(
    options?: QueryObserverOptions<TGenerics>
  ): QueryObserverOptions<TGenerics>
  defaultMutationOptions<TGenerics extends MutationGenerics>(
    options?: MutationOptions<TGenerics>
  ): MutationOptions<TGenerics>
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
    getQueryData: <TGenerics extends QueryGenerics>(
      filters?: QueryFilters
    ): TGenerics['Data'] | undefined => {
      return queryCache.find<TGenerics>(filters)?.state.data
    },
    setQueryData: <TGenerics extends QueryGenerics>(
      queryKey: TGenerics['QueryKey'],
      updater: Updater<TGenerics['Data'] | undefined, TGenerics['Data']>,
      options?: SetDataOptions
    ): TGenerics['Data'] => {
      const defaultedOptions = queryClient.defaultQueryOptions<TGenerics>({
        queryKey,
      })
      return queryCache
        .build<TGenerics>(queryClient, defaultedOptions)
        .setData(updater, options)
    },
    getQueryState: <TGenerics extends QueryGenerics>(
      filters?: QueryFilters
    ): QueryState<TGenerics> | undefined =>
      queryCache.find<TGenerics>(filters)?.state,
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
    fetchQuery: options => {
      const defaultedOptions = queryClient.defaultQueryOptions(options)

      // https://github.com/tannerlinsley/react-query/issues/652
      if (typeof defaultedOptions.retry === 'undefined') {
        defaultedOptions.retry = false
      }

      const query = queryCache.build(queryClient, defaultedOptions)

      return query.isStaleByTime(defaultedOptions.staleTime)
        ? query.fetch(defaultedOptions)
        : Promise.resolve(query.state.data)
    },
    prefetchQuery: options =>
      queryClient.fetchQuery(options).then(noop).catch(noop),
    fetchInfiniteQuery: <TGenerics extends QueryGenerics>(
      options: FetchQueryOptions<TGenerics>
    ): Promise<InfiniteQueryResult<TGenerics> | undefined> => {
      options.behavior = infiniteQueryBehavior()
      return (queryClient.fetchQuery<TGenerics>(
        options as any
      ) as unknown) as Promise<InfiniteQueryResult<TGenerics> | undefined>
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
    getQueryDefaults: <TGenerics extends QueryGenerics>(
      queryKey?: QueryKey
    ): QueryObserverOptions<TGenerics> | undefined => {
      return queryKey
        ? (queryDefaults.find(x => partialMatchKey(queryKey, x.queryKey))
            ?.defaultOptions as QueryObserverOptions<TGenerics> | undefined)
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
    getMutationDefaults: <TGenerics extends MutationGenerics>(
      mutationKey?: MutationKey
    ): MutationObserverOptions<TGenerics> | undefined => {
      return mutationKey
        ? (mutationDefaults.find(x =>
            partialMatchKey(mutationKey, x.mutationKey)
          )?.defaultOptions as MutationObserverOptions<TGenerics> | undefined)
        : undefined
    },
    defaultQueryOptions: <TGenerics extends QueryGenerics>(
      options?: QueryOptions<TGenerics>
    ): FetchQueryOptions<TGenerics> => {
      if (options?._defaulted) {
        return options
      }
      return {
        ...defaultOptions.queries,
        ...queryClient.getQueryDefaults(options?.queryKey),
        ...options,
        _defaulted: true,
      } as FetchQueryOptions<TGenerics>
    },
    defaultQueryObserverOptions: options => {
      return queryClient.defaultQueryOptions(options)
    },
    defaultMutationOptions: <TGenerics extends MutationGenerics>(
      options?: MutationOptions<TGenerics>
    ) => {
      if (options?._defaulted) {
        return options
      }

      return {
        ...defaultOptions.mutations,
        ...queryClient.getMutationDefaults(options?.mutationKey),
        ...options,
        _defaulted: true,
      } as MutationOptions<TGenerics>
    },
    clear: () => {
      queryCache.clear()
      mutationCache.clear()
    },
  }

  return queryClient
}
