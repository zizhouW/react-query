import {
  createQueryObserver,
  QueryGenerics,
  QueryObserver,
  QueryObserverOptions,
  QueryObserverResult,
} from '../core'
import { useBaseQuery } from './useBaseQuery'

// HOOK

export function useQuery<TGenerics extends QueryGenerics>(
  options: QueryObserverOptions<TGenerics>
) {
  return useBaseQuery<
    TGenerics,
    QueryObserverOptions<TGenerics>,
    QueryObserver<TGenerics>,
    QueryObserverResult<TGenerics>
  >(options, createQueryObserver)
}
