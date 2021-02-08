import type {
  FetchNextPageOptions,
  FetchPreviousPageOptions,
  InfiniteData,
  InfiniteQueryObserverOptions,
  InfiniteQueryObserverResult,
} from './types'
import type { QueryClient } from './queryClient'
import {
  ObserverFetchOptions,
  makeQueryObserver,
  QueryObserverListener,
} from './queryObserver'
import {
  hasNextPage,
  hasPreviousPage,
  infiniteQueryBehavior,
} from './infiniteQueryBehavior'
import { Subscribable } from './subscribable'

export type InfiniteQueryObserver<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryData = TQueryFnData
> = {
  subscribe: Subscribable<
    QueryObserverListener<InfiniteData<TData>, TError>
  >['subscribe']
  getCurrentResult(): InfiniteQueryObserverResult<TData, TError>
  setOptions(
    options?: InfiniteQueryObserverOptions<
      TQueryFnData,
      TError,
      TData,
      TQueryData
    >
  ): void
  fetchNextPage(
    options?: FetchNextPageOptions
  ): Promise<InfiniteQueryObserverResult<TData, TError>>
  fetchPreviousPage(
    options?: FetchPreviousPageOptions
  ): Promise<InfiniteQueryObserverResult<TData, TError>>
  fetch(
    fetchOptions?: ObserverFetchOptions
  ): Promise<InfiniteQueryObserverResult<TData, TError>>
  getNewResult(): InfiniteQueryObserverResult<TData, TError>
}

export function makeInfiniteQueryObserver<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryData = TQueryFnData
>(
  client: QueryClient,
  options: InfiniteQueryObserverOptions<TQueryFnData, TError, TData, TQueryData>
) {
  const queryObserver = makeQueryObserver<
    TQueryFnData,
    TError,
    InfiniteData<TData>,
    InfiniteData<TQueryData>
  >(client, options)

  const infiniteQueryObserver: InfiniteQueryObserver<
    TQueryFnData,
    TError,
    TData,
    TQueryData
  > = {
    subscribe: listener => queryObserver.subscribe(listener),
    getCurrentResult: (...args) =>
      queryObserver.getCurrentResult(...args) as InfiniteQueryObserverResult<
        TData,
        TError
      >,
    setOptions: newOptions => {
      queryObserver.setOptions({
        ...newOptions,
        behavior: infiniteQueryBehavior<TQueryFnData, TError, TData>(),
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
        InfiniteQueryObserverResult<TData, TError>
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
      }
    },
  }

  return infiniteQueryObserver
}
