import { createQueryObserver } from '../core'
import { UseQueryOptions, UseQueryResult } from './types'
import { useBaseQuery } from './useBaseQuery'

// HOOK

export function useQuery<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData
>(
  options: UseQueryOptions<TQueryFnData, TError, TData>
): UseQueryResult<TData, TError> {
  return useBaseQuery(options, createQueryObserver)
}
