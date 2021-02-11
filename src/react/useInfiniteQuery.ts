import {
  InfiniteQueryGenerics,
  InfiniteQueryObserverResult,
  QueryObserver,
  QueryObserverOptions,
} from '../core'
import { createInfiniteQueryObserver } from '../core/infiniteQueryObserver'
import { useBaseQuery } from './useBaseQuery'

// HOOK

export function useInfiniteQuery<TGenerics extends InfiniteQueryGenerics>(
  options: QueryObserverOptions<TGenerics>
) {
  return useBaseQuery<
    TGenerics,
    QueryObserverOptions<TGenerics>,
    QueryObserver<TGenerics>,
    InfiniteQueryObserverResult<TGenerics>
  >(options, createInfiniteQueryObserver)
}
