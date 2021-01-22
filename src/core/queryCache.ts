import { QueryFilters, getQueryKeyHashFn, matchQuery } from './utils'
import { makeQuery, Query, QueryState } from './query'
import type { QueryOptions } from './types'
import { notifyManager } from './notifyManager'
import type { QueryClient } from './queryClient'
import { Subscribable } from './subscribable'

// TYPES

interface QueryCacheConfig {
  onError?: (error: unknown, query: Query<unknown, unknown, unknown>) => void
}

interface QueryHashMap {
  [hash: string]: Query<any, any>
}

type QueryCacheListener = (query?: Query) => void

// CLASS

export type QueryCache = {
  config?: QueryCacheConfig
  subscribe: Subscribable<QueryCacheListener>['subscribe']
  build<TQueryFnData, TError, TData>(
    client: QueryClient,
    options: QueryOptions<TQueryFnData, TError, TData>,
    state?: QueryState<TData, TError>
  ): Query<TQueryFnData, TError, TData>
  add(query: Query<any, any>): void
  remove(query: Query<any, any>): void
  clear(): void
  get<TQueryFnData = unknown, TError = unknown, TData = TQueryFnData>(
    queryHash: string
  ): Query<TQueryFnData, TError, TData> | undefined
  getAll(): Query[]
  find<TQueryFnData = unknown, TError = unknown, TData = TQueryFnData>(
    filters?: QueryFilters
  ): Query<TQueryFnData, TError, TData> | undefined
  findAll(filters?: QueryFilters): Query[]
  notify(query?: Query<any, any>): void
  onFocus(): void
  onOnline(): void
}

export function makeQueryCache(config?: QueryCacheConfig) {
  let queries: Query<any, any>[] = []
  const queriesMap: QueryHashMap = {}
  const subscribable = Subscribable<QueryCacheListener>()

  const queryCache: QueryCache = {
    config,
    subscribe: subscribable.subscribe,
    build: <TQueryFnData, TError, TData>(
      client: QueryClient,
      options: QueryOptions<TQueryFnData, TError, TData>,
      state?: QueryState<TData, TError>
    ) => {
      const hashFn = getQueryKeyHashFn(options)
      const queryKey = options.queryKey!
      const queryHash = options.queryHash ?? hashFn(queryKey)
      let query = queryCache.get<TQueryFnData, TError, TData>(queryHash)

      if (!query) {
        query = makeQuery<TQueryFnData, TError, TData>({
          cache: queryCache,
          queryKey,
          queryHash,
          options: client.defaultQueryOptions(options),
          state,
          defaultOptions: client.getQueryDefaults(queryKey),
        })
        queryCache.add(query)
      }

      return query
    },
    add: query => {
      if (!queriesMap[query.queryHash]) {
        queriesMap[query.queryHash] = query
        queries.push(query)
        queryCache.notify(query)
      }
    },
    remove: query => {
      const queryInMap = queriesMap[query.queryHash]

      if (queryInMap) {
        query.destroy()

        queries = queries.filter(x => x !== query)

        if (queryInMap === query) {
          delete queriesMap[query.queryHash]
        }

        queryCache.notify(query)
      }
    },
    clear: () => {
      notifyManager.batch(() => {
        queries.forEach(query => {
          queryCache.remove(query)
        })
      })
    },
    get: queryHash => {
      return queriesMap[queryHash]
    },
    getAll: () => {
      return queries
    },
    find: (filters = {}) => {
      return queries.find(query => matchQuery(filters, query))
    },
    findAll: filters =>
      filters ? queries.filter(query => matchQuery(filters, query)) : queries,
    notify: query => {
      notifyManager.batch(() => {
        subscribable.listeners.forEach(listener => {
          listener(query)
        })
      })
    },
    onFocus: () => {
      notifyManager.batch(() => {
        queries.forEach(query => {
          query.onFocus()
        })
      })
    },
    onOnline: () => {
      notifyManager.batch(() => {
        queries.forEach(query => {
          query.onOnline()
        })
      })
    },
  }

  return queryCache
}
