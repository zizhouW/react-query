import { makeQueryObserver } from '../core'
import { makeInfiniteQueryObserver } from '../core/infiniteQueryObserver'
import {
  UseBaseQueryOptions,
  UseInfiniteQueryOptions,
  UseInfiniteQueryResult,
} from './types'
import { useBaseQuery } from './useBaseQuery'

// HOOK

export function useInfiniteQuery<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData
>(
  options: UseInfiniteQueryOptions<TQueryFnData, TError, TData>
): UseInfiniteQueryResult<TData, TError> {
  return useBaseQuery(
    options as UseBaseQueryOptions,
    makeInfiniteQueryObserver as typeof makeQueryObserver
  ) as UseInfiniteQueryResult<TData, TError>
}
