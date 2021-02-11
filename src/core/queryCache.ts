import { QueryFilters, getQueryKeyHashFn, matchQuery } from './utils'
import { createQuery, Query, QueryState } from './query'
import type { QueryGenerics, QueryOptions } from './types'
import { notifyManager } from './notifyManager'
import type { QueryClient } from './queryClient'
import { Subscribable } from './subscribable'
import { SetRequired } from 'type-fest'

// TYPES

interface QueryCacheConfig {
  onError?: <TGenerics extends QueryGenerics>(
    error: unknown,
    query: Query<TGenerics>
  ) => void
}

interface QueryHashMap {
  [hash: string]: Query<any>
}

type QueryCacheListener = (query?: Query<any>) => void

// CLASS

export type QueryCache = {
  config?: QueryCacheConfig
  subscribe: Subscribable<QueryCacheListener>['subscribe']
  build<TGenerics extends QueryGenerics>(
    client: QueryClient,
    options: QueryOptions<TGenerics>,
    state?: QueryState<TGenerics>
  ): Query<TGenerics>
  add<TGenerics extends QueryGenerics>(query: Query<TGenerics>): void
  remove(query: Query<any>): void
  clear(): void
  get<TGenerics extends QueryGenerics>(
    queryHash: string
  ): Query<TGenerics> | undefined
  getAll<TGenerics extends QueryGenerics>(): Query<TGenerics>[]
  find<TGenerics extends QueryGenerics>(
    filters?: QueryFilters
  ): Query<TGenerics> | undefined
  findAll(filters?: QueryFilters): Query<QueryGenerics>[]
  notify(query?: Query<any>): void
  onFocus(): void
  onOnline(): void
}

export function createQueryCache(config?: QueryCacheConfig) {
  let queries: Query<any>[] = []
  const queriesMap: QueryHashMap = {}
  const subscribable = Subscribable<QueryCacheListener>()

  const queryCache: QueryCache = {
    config,
    subscribe: subscribable.subscribe,
    build: <TGenerics extends QueryGenerics>(
      client: QueryClient,
      options: SetRequired<QueryOptions<TGenerics>, 'queryKey'>,
      state?: QueryState<TGenerics>
    ) => {
      const hashFn = getQueryKeyHashFn(options)
      const queryKey = options.queryKey
      const queryHash = options.queryHash ?? hashFn(queryKey)
      let query = queryCache.get<TGenerics>(queryHash)

      if (!query) {
        query = createQuery<TGenerics>({
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
      filters.exact = filters.exact ?? true
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
