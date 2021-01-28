import {
  InfiniteQueryObserverOptions,
  InfiniteQueryObserverResult,
  MutateOptions,
  MutationStatus,
  QueryObserverOptions,
  QueryObserverResult,
} from '../core/types'

export interface UseBaseQueryOptions<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryData = TQueryFnData
> extends QueryObserverOptions<TQueryFnData, TError, TData, TQueryData> {}

export interface UseQueryOptions<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData
> extends UseBaseQueryOptions<TQueryFnData, TError, TData> {}

export interface UseInfiniteQueryOptions<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryData = TQueryFnData
>
  extends InfiniteQueryObserverOptions<
    TQueryFnData,
    TError,
    TData,
    TQueryData
  > {}

export type UseBaseQueryResult<
  TData = unknown,
  TError = unknown
> = QueryObserverResult<TData, TError>

export type UseQueryResult<
  TData = unknown,
  TError = unknown
> = UseBaseQueryResult<TData, TError>

export type UseInfiniteQueryResult<
  TData = unknown,
  TError = unknown
> = InfiniteQueryObserverResult<TData, TError>

export type UseMutateFunction<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown
> = (
  variables: TVariables,
  options?: MutateOptions<TData, TError, TVariables, TContext>
) => void

export type UseMutateAsyncFunction<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown
> = (
  variables: TVariables,
  options?: MutateOptions<TData, TError, TVariables, TContext>
) => Promisable<TGenerics['Data']>

export interface UseMutationResult<
  TData = unknown,
  TError = unknown,
  TVariables = unknown,
  TContext = unknown
> {
  context: TContext | undefined
  data: TData | undefined
  error: TError | null
  failureCount: number
  isError: boolean
  isIdle: boolean
  isLoading: boolean
  isPaused: boolean
  isSuccess: boolean
  mutate: UseMutateFunction<TData, TError, TVariables, TContext>
  mutateAsync: UseMutateAsyncFunction<TData, TError, TVariables, TContext>
  reset: () => void
  status: MutationStatus
  variables: TVariables | undefined
}
