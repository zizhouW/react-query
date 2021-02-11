import type {
  FetchNextPageOptions,
  FetchPreviousPageOptions,
  QueryObserverOptions,
  InfiniteQueryObserverResult,
  QueryGenerics,
  ResolvedQueryGenerics,
} from './types'
import type { QueryClient } from './queryClient'
import {
  ObserverFetchOptions,
  createQueryObserver,
  QueryObserverListener,
  QueryObserver,
} from './queryObserver'
import {
  hasNextPage,
  hasPreviousPage,
  infiniteQueryBehavior,
} from './infiniteQueryBehavior'
import { Subscribable } from './subscribable'
import { Merge } from 'type-fest'

export type InfiniteQueryObserver<
  TGenericsIn extends QueryGenerics,
  TGenerics extends ResolvedQueryGenerics<TGenericsIn> = ResolvedQueryGenerics<
    TGenericsIn
  >
> = Merge<
  QueryObserver<TGenerics>,
  {
    subscribe: Subscribable<QueryObserverListener<TGenerics>>['subscribe']
    getCurrentResult(): InfiniteQueryObserverResult<TGenerics>
    setOptions(newOptions?: QueryObserverOptions<TGenerics>): void
    fetchNextPage(
      options?: FetchNextPageOptions
    ): Promise<InfiniteQueryObserverResult<TGenerics>>
    fetchPreviousPage(
      options?: FetchPreviousPageOptions
    ): Promise<InfiniteQueryObserverResult<TGenerics>>
    fetch(
      fetchOptions?: ObserverFetchOptions
    ): Promise<InfiniteQueryObserverResult<TGenerics>>
    getNewResult(): InfiniteQueryObserverResult<TGenerics>
  }
>

export function createInfiniteQueryObserver<
  TGenericsIn extends QueryGenerics,
  TGenerics extends ResolvedQueryGenerics<TGenericsIn> = ResolvedQueryGenerics<
    TGenericsIn
  >
>(
  client: QueryClient,
  observerOptions: QueryObserverOptions<TGenerics>
): InfiniteQueryObserver<TGenerics> {
  const queryObserver = createQueryObserver<TGenerics>(client, observerOptions)

  const infiniteQueryObserver: InfiniteQueryObserver<TGenerics> = {
    ...queryObserver,
    // subscribe: listener => queryObserver.subscribe(listener),
    getCurrentResult: (...args) =>
      queryObserver.getCurrentResult(...args) as InfiniteQueryObserverResult<
        TGenerics
      >,
    setOptions: newOptions => {
      queryObserver.setOptions({
        ...newOptions,
        behavior: infiniteQueryBehavior(),
      })
    },
    fetchNextPage: fetchOptions => {
      return infiniteQueryObserver.fetch({
        cancelRefetch: true,
        throwOnError: fetchOptions?.throwOnError,
        meta: {
          fetchMore: {
            direction: 'forward',
            pageParam: fetchOptions?.pageParam,
          },
        },
      })
    },
    fetchPreviousPage: fetchOptions => {
      return infiniteQueryObserver.fetch({
        cancelRefetch: true,
        throwOnError: fetchOptions?.throwOnError,
        meta: {
          fetchMore: {
            direction: 'backward',
            pageParam: fetchOptions?.pageParam,
          },
        },
      })
    },
    fetch: fetchOptions => {
      return queryObserver.fetch(fetchOptions) as Promise<
        InfiniteQueryObserverResult<TGenerics>
      >
    },
    getNewResult: () => {
      const { state } = queryObserver.getCurrentQuery()
      const result = queryObserver.getNewResult()
      return {
        ...result,
        fetchNextPage: infiniteQueryObserver.fetchNextPage,
        fetchPreviousPage: infiniteQueryObserver.fetchPreviousPage,
        hasNextPage: hasNextPage(queryObserver.options, state.data?.pages),
        hasPreviousPage: hasPreviousPage(
          queryObserver.options,
          state.data?.pages
        ),
        isFetchingNextPage:
          state.isFetching &&
          state.fetchMeta?.fetchMore?.direction === 'forward',
        isFetchingPreviousPage:
          state.isFetching &&
          state.fetchMeta?.fetchMore?.direction === 'backward',
      } as InfiniteQueryObserverResult<TGenerics>
    },
  }

  return infiniteQueryObserver
}
