import {
  MutateOptions,
  MutationGenerics,
  MutationStatus,
  QueryObserverResult,
} from '../core/types'

export type UseBaseQueryResult<TGenerics> = QueryObserverResult<TGenerics>

export type UseMutateFunction<TGenerics extends MutationGenerics> = (
  variables: TGenerics['Variables'],
  options?: MutateOptions<TGenerics>
) => void

export type UseMutateAsyncFunction<TGenerics extends MutationGenerics> = (
  variables: TGenerics['Variables'],
  options?: MutateOptions<TGenerics>
) => Promise<TGenerics['Data']>

export interface UseMutationResult<TGenerics extends MutationGenerics> {
  context: TGenerics['Context'] | undefined
  data: TGenerics['Data'] | undefined
  error: TGenerics['Error'] | null
  failureCount: number
  isError: boolean
  isIdle: boolean
  isLoading: boolean
  isPaused: boolean
  isSuccess: boolean
  mutate: UseMutateFunction<TGenerics>
  mutateAsync: UseMutateAsyncFunction<TGenerics>
  reset: () => void
  status: MutationStatus
  variables: TGenerics['Variables'] | undefined
}
