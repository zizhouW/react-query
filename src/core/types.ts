// import { Merge, Promisable } from 'type-fest'
import type { MutationState } from './mutation'
import type { QueryBehavior } from './query'
import type { RetryValue, RetryDelayValue } from './retryer'
import type { QueryFilters } from './utils'

export interface DefaultQueryGenerics {
  Data?: unknown
  Error?: unknown
  Variables?: unknown
  PageParam?: unknown
  NextPageParam?: unknown
  PreviousPageParam?: unknown
}

export interface DefaultMutationGenerics {
  Data?: unknown
  Error?: unknown
  Variables?: unknown
  Context?: unknown
}

type Prettify<T> = T extends infer U ? { [K in keyof U]: U[K] } : never

export type MergeGenerics<TLeft, TRight> = Prettify<
  Merge<Required<TLeft>, TRight>
>

export type MergeQueryGenerics<TUserGenerics> = MergeGenerics<
  DefaultQueryGenerics,
  TUserGenerics
>

export type MergeMutationGenerics<TUserGenerics> = MergeGenerics<
  DefaultMutationGenerics,
  TUserGenerics
>

export type QueryFunction<TGenerics extends DefaultQueryGenerics> = (
  context: QueryFunctionContext<TGenerics>
) => Promisable<TGenerics['Data']>

export interface QueryFunctionContext<TGenerics extends DefaultQueryGenerics> {
  variables: TGenerics['Variables']
  pageParam?: TGenerics['PageParam']
}

export type InitialDataFunction<T> = () => T | undefined
export type PlaceholderDataFunction<T> = () => T | undefined
export type InitialStaleFunction = () => boolean

export type GetPreviousPageParamFunction<
  TGenerics extends DefaultQueryGenerics
> = (
  firstPage: TGenerics['Data'],
  allPages: TGenerics['Data'][]
) => TGenerics['PreviousPageParam']

export type GetNextPageParamFunction<TGenerics extends DefaultQueryGenerics> = (
  lastPage: TGenerics['Data'],
  allPages: TGenerics['Data'][]
) => TGenerics['NextPageParam']

export interface InfiniteQueryResult<TGenerics extends DefaultQueryGenerics> {
  pages: TGenerics['Data'][]
  pageParams: TGenerics['PageParam'][]
}

export interface QueryOptions<TGenerics extends DefaultQueryGenerics> {
  /**
   * If `false`, failed queries will not retry by default.
   * If `true`, failed queries will retry infinitely., failureCount: num
   * If set to an integer number, e.g. 3, failed queries will retry until the failed query count meets that number.
   * If set to a function `(failureCount, error) => boolean` failed queries will retry until the function returns false.
   */
  retry?: RetryValue<TGenerics['Error']>
  retryDelay?: RetryDelayValue
  cacheTime?: number
  isDataEqual?: (
    oldData: TGenerics['Data'] | undefined,
    newData: TGenerics['Data']
  ) => boolean
  queryFn?: QueryFunction<TGenerics>
  // queryKeyHashFn?: QueryKeyHashFunction
  initialData?: TGenerics['Data'] | InitialDataFunction<TGenerics['Data']>
  initialDataUpdatedAt?: number | (() => number | undefined)
  behavior?: QueryBehavior<TGenerics>
  /**
   * Set this to `false` to disable structural sharing between query results.
   * Defaults to `true`.
   */
  structuralSharing?: boolean
  /**
   * This function can be set to automatically get the previous cursor for infinite queries.
   * The result will also be used to determine the value of `hasPreviousPage`.
   */
  getPreviousPageParam?: GetPreviousPageParamFunction<TGenerics>
  /**
   * This function can be set to automatically get the next cursor for infinite queries.
   * The result will also be used to determine the value of `hasNextPage`.
   */
  getNextPageParam?: GetNextPageParamFunction<TGenerics>
  _defaulted?: boolean
}

export interface QueryObserverOptions<TGenerics extends DefaultQueryGenerics>
  extends QueryOptions<TGenerics> {
  /**
   * Set this to `false` to disable automatic refetching when the query mounts or changes query keys.
   * To refetch the query, use the `refetch` method returned from the `useQuery` instance.
   * Defaults to `true`.
   */
  enabled?: boolean
  /**
   * The time in milliseconds after data is considered stale.
   * If set to `Infinity`, the data will never be considered stale.
   */
  staleTime?: number
  /**
   * If set to a number, the query will continuously refetch at this frequency in milliseconds.
   * Defaults to `false`.
   */
  refetchInterval?: number | false
  /**
   * If set to `true`, the query will continue to refetch while their tab/window is in the background.
   * Defaults to `false`.
   */
  refetchIntervalInBackground?: boolean
  /**
   * If set to `true`, the query will refetch on window focus if the data is stale.
   * If set to `false`, the query will not refetch on window focus.
   * If set to `'always'`, the query will always refetch on window focus.
   * Defaults to `true`.
   */
  refetchOnWindowFocus?: boolean | 'always'
  /**
   * If set to `true`, the query will refetch on reconnect if the data is stale.
   * If set to `false`, the query will not refetch on reconnect.
   * If set to `'always'`, the query will always refetch on reconnect.
   * Defaults to `true`.
   */
  refetchOnReconnect?: boolean | 'always'
  /**
   * If set to `true`, the query will refetch on mount if the data is stale.
   * If set to `false`, will disable additional instances of a query to trigger background refetches.
   * If set to `'always'`, the query will always refetch on mount.
   * Defaults to `true`.
   */
  refetchOnMount?: boolean | 'always'
  /**
   * If set to `false`, the query will not be retried on mount if it contains an error.
   * Defaults to `true`.
   */
  retryOnMount?: boolean
  /**
   * If set, the component will only re-render if any of the listed properties change.
   * When set to `['data', 'error']`, the component will only re-render when the `data` or `error` properties change.
   */
  notifyOnChangeProps?: Array<keyof InfiniteQueryObserverResult<TGenerics>>
  /**
   * If set, the component will not re-render if any of the listed properties change.
   */
  notifyOnChangePropsExclusions?: Array<
    keyof InfiniteQueryObserverResult<TGenerics>
  >
  /**
   * This callback will fire any time the query successfully fetches new data.
   */
  onSuccess?: (data: TGenerics['Data']) => void
  /**
   * This callback will fire if the query encounters an error and will be passed the error.
   */
  onError?: (err: TGenerics['Error']) => void
  /**
   * This callback will fire any time the query is either successfully fetched or errors and be passed either the data or error.
   */
  onSettled?: (
    data: TGenerics['Data'] | undefined,
    error: TGenerics['Error'] | null
  ) => void
  /**
   * Whether errors should be thrown instead of setting the `error` property.
   * Defaults to `false`.
   */
  useErrorBoundary?: boolean
  /**
   * If set to `true`, the query will suspend when `status === 'loading'`
   * and throw errors when `status === 'error'`.
   * Defaults to `false`.
   */
  suspense?: boolean
  /**
   * Set this to `true` to keep the previous `data` when fetching based on a new query key.
   * Defaults to `false`.
   */
  keepPreviousData?: boolean
  /**
   * If set, this value will be used as the placeholder data for this particular query observer while the query is still in the `loading` data and no initialData has been provided.
   */
  placeholderData?:
    | TGenerics['Data']
    | PlaceholderDataFunction<TGenerics['Data']>
}

export interface FetchQueryOptions<TGenerics extends DefaultQueryGenerics>
  extends QueryOptions<TGenerics> {
  /**
   * The time in milliseconds after data is considered stale.
   * If the data is fresh it will be returned from the cache.
   */
  staleTime?: number
}

export interface FetchInfiniteQueryOptions<
  TGenerics extends DefaultQueryGenerics
>
  extends FetchQueryOptions<
    Merge<TGenerics, { Data: InfiniteQueryResult<TGenerics> }>
  > {}

export interface ResultOptions {
  throwOnError?: boolean
}

export interface RefetchOptions extends ResultOptions {}

export interface InvalidateQueryFilters extends QueryFilters {
  refetchActive?: boolean
  refetchInactive?: boolean
}

export interface InvalidateOptions {
  throwOnError?: boolean
}

export interface ResetOptions {
  throwOnError?: boolean
}

export interface FetchNextPageOptions extends ResultOptions {
  pageParam?: unknown
}

export interface FetchPreviousPageOptions extends ResultOptions {
  pageParam?: unknown
}

export type QueryStatus = 'idle' | 'loading' | 'error' | 'success'

export interface QueryObserverBaseResult<
  TGenerics extends DefaultQueryGenerics
> {
  data: TGenerics['Data'] | undefined
  dataUpdatedAt: number
  error: TGenerics['Error'] | null
  errorUpdatedAt: number
  failureCount: number
  isError: boolean
  isFetched: boolean
  isFetchedAfterMount: boolean
  isFetching: boolean
  isIdle: boolean
  isLoading: boolean
  isLoadingError: boolean
  isPlaceholderData: boolean
  isPreviousData: boolean
  isRefetchError: boolean
  isStale: boolean
  isSuccess: boolean
  refetch: (options?: RefetchOptions) => Promise<QueryObserverResult<TGenerics>>
  remove: () => void
  status: QueryStatus
}

export interface QueryObserverIdleResult<
  TGenerics extends DefaultQueryGenerics
> extends QueryObserverBaseResult<TGenerics> {
  data: undefined
  error: null
  isError: false
  isIdle: true
  isLoading: false
  isLoadingError: false
  isRefetchError: false
  isSuccess: false
  status: 'idle'
}

export interface QueryObserverLoadingResult<
  TGenerics extends DefaultQueryGenerics
> extends QueryObserverBaseResult<TGenerics> {
  data: undefined
  error: null
  isError: false
  isIdle: false
  isLoading: true
  isLoadingError: false
  isRefetchError: false
  isSuccess: false
  status: 'loading'
}

export interface QueryObserverLoadingErrorResult<
  TGenerics extends DefaultQueryGenerics
> extends QueryObserverBaseResult<TGenerics> {
  data: undefined
  error: TGenerics['Error']
  isError: true
  isIdle: false
  isLoading: false
  isLoadingError: true
  isRefetchError: false
  isSuccess: false
  status: 'error'
}

export interface QueryObserverRefetchErrorResult<
  TGenerics extends DefaultQueryGenerics
> extends QueryObserverBaseResult<TGenerics> {
  data: TGenerics['Data']
  error: TGenerics['Error']
  isError: true
  isIdle: false
  isLoading: false
  isLoadingError: false
  isRefetchError: true
  isSuccess: false
  status: 'error'
}

export interface QueryObserverSuccessResult<
  TGenerics extends DefaultQueryGenerics
> extends QueryObserverBaseResult<TGenerics> {
  data: TGenerics['Data']
  error: null
  isError: false
  isIdle: false
  isLoading: false
  isLoadingError: false
  isRefetchError: false
  isSuccess: true
  status: 'success'
}

export type QueryObserverResult<TGenerics> =
  | QueryObserverIdleResult<TGenerics>
  | QueryObserverLoadingErrorResult<TGenerics>
  | QueryObserverLoadingResult<TGenerics>
  | QueryObserverRefetchErrorResult<TGenerics>
  | QueryObserverSuccessResult<TGenerics>

export interface InfiniteQueryObserverBaseResult<
  TGenerics extends DefaultQueryGenerics
> extends QueryObserverBaseResult<TGenerics> {
  fetchNextPage: (
    options?: FetchNextPageOptions
  ) => Promise<InfiniteQueryObserverResult<TGenerics>>
  fetchPreviousPage: (
    options?: FetchPreviousPageOptions
  ) => Promise<InfiniteQueryObserverResult<TGenerics>>
  hasNextPage?: boolean
  hasPreviousPage?: boolean
  isFetchingNextPage: boolean
  isFetchingPreviousPage: boolean
}

export interface InfiniteQueryObserverIdleResult<
  TGenerics extends DefaultQueryGenerics
> extends InfiniteQueryObserverBaseResult<TGenerics> {
  data: undefined
  error: null
  isError: false
  isIdle: true
  isLoading: false
  isLoadingError: false
  isRefetchError: false
  isSuccess: false
  status: 'idle'
}

export interface InfiniteQueryObserverLoadingResult<
  TGenerics extends DefaultQueryGenerics
> extends InfiniteQueryObserverBaseResult<TGenerics> {
  data: undefined
  error: null
  isError: false
  isIdle: false
  isLoading: true
  isLoadingError: false
  isRefetchError: false
  isSuccess: false
  status: 'loading'
}

export interface InfiniteQueryObserverLoadingErrorResult<
  TGenerics extends DefaultQueryGenerics
> extends InfiniteQueryObserverBaseResult<TGenerics> {
  data: undefined
  error: TGenerics['Error']
  isError: true
  isIdle: false
  isLoading: false
  isLoadingError: true
  isRefetchError: false
  isSuccess: false
  status: 'error'
}

export interface InfiniteQueryObserverRefetchErrorResult<
  TGenerics extends DefaultQueryGenerics
> extends InfiniteQueryObserverBaseResult<TGenerics> {
  data: InfiniteQueryResult<TGenerics>
  error: TGenerics['Error']
  isError: true
  isIdle: false
  isLoading: false
  isLoadingError: false
  isRefetchError: true
  isSuccess: false
  status: 'error'
}

export interface InfiniteQueryObserverSuccessResult<
  TGenerics extends DefaultQueryGenerics
> extends InfiniteQueryObserverBaseResult<TGenerics> {
  data: InfiniteQueryResult<TGenerics>
  error: null
  isError: false
  isIdle: false
  isLoading: false
  isLoadingError: false
  isRefetchError: false
  isSuccess: true
  status: 'success'
}

export type InfiniteQueryObserverResult<
  TGenerics extends DefaultQueryGenerics
> =
  | InfiniteQueryObserverIdleResult<TGenerics>
  | InfiniteQueryObserverLoadingErrorResult<TGenerics>
  | InfiniteQueryObserverLoadingResult<TGenerics>
  | InfiniteQueryObserverRefetchErrorResult<TGenerics>
  | InfiniteQueryObserverSuccessResult<TGenerics>

export type MutationKey = string | unknown[]

export type MutationStatus = 'idle' | 'loading' | 'success' | 'error'

export type MutationFunction<TGenerics extends DefaultMutationGenerics> = (
  variables: TGenerics['Variables']
) => Promisable<TGenerics['Data']>

export interface MutationOptions<TGenerics extends DefaultMutationGenerics> {
  mutationFn?: MutationFunction<TGenerics>
  mutationKey?: string | unknown[]
  variables?: TGenerics['Variables']
  onMutate?: (
    variables: TGenerics['Variables']
  ) => Promise<TGenerics['Context']> | TGenerics['Context']
  onSuccess?: (
    data: TGenerics['Data'],
    variables: TGenerics['Variables'],
    context: TGenerics['Context']
  ) => Promise<void> | void
  onError?: (
    error: TGenerics['Error'],
    variables: TGenerics['Variables'],
    context: TGenerics['Context'] | undefined
  ) => Promise<void> | void
  onSettled?: (
    data: TGenerics['Data'] | undefined,
    error: TGenerics['Error'] | null,
    variables: TGenerics['Variables'],
    context: TGenerics['Context'] | undefined
  ) => Promise<void> | void
  retry?: RetryValue<TGenerics['Error']>
  retryDelay?: RetryDelayValue
  _defaulted?: boolean
}

export interface MutationObserverOptions<
  TGenerics extends DefaultMutationGenerics
> extends MutationOptions<TGenerics> {
  useErrorBoundary?: boolean
}

export interface MutateOptions<TGenerics extends DefaultMutationGenerics> {
  onSuccess?: (
    data: TGenerics['Data'],
    variables: TGenerics['Variables'],
    context: TGenerics['Context']
  ) => Promise<void> | void
  onError?: (
    error: TGenerics['Error'],
    variables: TGenerics['Variables'],
    context: TGenerics['Context'] | undefined
  ) => Promise<void> | void
  onSettled?: (
    data: TGenerics['Data'] | undefined,
    error: TGenerics['Error'] | null,
    variables: TGenerics['Variables'],
    context: TGenerics['Context'] | undefined
  ) => Promise<void> | void
}

export type MutateFunction<TGenerics extends DefaultMutationGenerics> = (
  variables: TGenerics['Variables'],
  options?: MutateOptions<TGenerics>
) => Promisable<TGenerics['Data']>

export interface MutationObserverResult<
  TGenerics extends DefaultMutationGenerics
> extends MutationState<TGenerics> {
  isError: boolean
  isIdle: boolean
  isLoading: boolean
  isSuccess: boolean
  mutate: MutateFunction<TGenerics>
  reset: () => void
}

export interface DefaultQueryClientOptions<TError = unknown> {
  queries?: QueryObserverOptions<{ Error: TError }>
  mutations?: MutationObserverOptions<{ Error: TError }>
}
