import type { MutationOptions, MutationStatus } from './types'
import type { MutationCache } from './mutationCache'
import type { MutationObserver } from './mutationObserver'
import { getLogger } from './logger'
import { notifyManager } from './notifyManager'
import { makeRetryer, Retryer } from './retryer'
import { noop } from './utils'

// TYPES

interface MutationConfig<TData, TError, TVariables, TContext> {
  mutationId: number
  mutationCache: MutationCache
  options: MutationOptions<TData, TError, TVariables, TContext>
  defaultOptions?: MutationOptions<TData, TError, TVariables, TContext>
  state?: MutationState<TData, TError, TVariables, TContext>
}

export interface MutationState<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown
> {
  context: TContext | undefined
  data: TData | undefined
  error: TError | null
  failureCount: number
  isPaused: boolean
  status: MutationStatus
  variables: TVariables | undefined
}

interface FailedAction {
  type: 'failed'
}

interface LoadingAction<TVariables, TContext> {
  type: 'loading'
  variables?: TVariables
  context?: TContext
}

interface SuccessAction<TData> {
  type: 'success'
  data: TData
}

interface ErrorAction<TError> {
  type: 'error'
  error: TError
}

interface PauseAction {
  type: 'pause'
}

interface ContinueAction {
  type: 'continue'
}

interface SetStateAction<TData, TError, TVariables, TContext> {
  type: 'setState'
  state: MutationState<TData, TError, TVariables, TContext>
}

export type Action<TData, TError, TVariables, TContext> =
  | ContinueAction
  | ErrorAction<TError>
  | FailedAction
  | LoadingAction<TVariables, TContext>
  | PauseAction
  | SetStateAction<TData, TError, TVariables, TContext>
  | SuccessAction<TData>

// CLASS

export type Mutation<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown
> = {
  state: MutationState<TData, TError, TVariables, TContext>
  options: MutationOptions<TData, TError, TVariables, TContext>
  mutationId: number
  setState(state: MutationState<TData, TError, TVariables, TContext>): void
  addObserver(observer: MutationObserver<any, any, any, any>): void
  removeObserver(observer: MutationObserver<any, any, any, any>): void
  cancel(): Promise<void>
  continue(): Promise<TData>
  execute(): Promise<TData>
}

export function makeMutation<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown
>(config: MutationConfig<TData, TError, TVariables, TContext>) {
  let observers: MutationObserver<TData, TError, TVariables, TContext>[] = []
  let retryer: Retryer<TData>

  const mutation: Mutation<TData, TError, TVariables, TContext> = {
    options: {
      ...config.defaultOptions,
      ...config.options,
    },
    mutationId: config.mutationId,
    state: config.state || getDefaultState(),
    setState: state => {
      dispatch({ type: 'setState', state })
    },
    addObserver: observer => {
      if (observers.indexOf(observer) === -1) {
        observers.push(observer)
      }
    },
    removeObserver: observer => {
      observers = observers.filter(x => x !== observer)
    },
    cancel: () => {
      if (retryer) {
        retryer.cancel()
        return retryer.promise.then(noop).catch(noop)
      }
      return Promise.resolve()
    },
    continue: () => {
      if (retryer) {
        retryer.proceed()
        return retryer.promise
      }
      return mutation.execute()
    },
    execute: () => {
      let data: TData

      const restored = mutation.state.status === 'loading'

      let promise = Promise.resolve()

      if (!restored) {
        dispatch({ type: 'loading', variables: mutation.options.variables! })
        promise = promise
          .then(() => mutation.options.onMutate?.(mutation.state.variables!))
          .then(context => {
            if (context !== mutation.state.context) {
              dispatch({
                type: 'loading',
                context,
                variables: mutation.state.variables,
              })
            }
          })
      }

      return promise
        .then(() => executeMutation())
        .then(result => {
          data = result
        })
        .then(() =>
          mutation.options.onSuccess?.(
            data,
            mutation.state.variables!,
            mutation.state.context!
          )
        )
        .then(() =>
          mutation.options.onSettled?.(
            data,
            null,
            mutation.state.variables!,
            mutation.state.context
          )
        )
        .then(() => {
          dispatch({ type: 'success', data })
          return data
        })
        .catch(error => {
          // Notify cache callback
          if (config.mutationCache.config.onError) {
            config.mutationCache.config.onError(
              error,
              mutation.state.variables,
              mutation.state.context,
              mutation as Mutation<unknown, unknown, unknown, unknown>
            )
          }

          // Log error
          getLogger().error(error)

          return Promise.resolve()
            .then(() =>
              mutation.options.onError?.(
                error,
                mutation.state.variables!,
                mutation.state.context
              )
            )
            .then(() =>
              mutation.options.onSettled?.(
                undefined,
                error,
                mutation.state.variables!,
                mutation.state.context
              )
            )
            .then(() => {
              dispatch({ type: 'error', error })
              throw error
            })
        })
    },
  }

  return mutation

  function executeMutation(): Promise<TData> {
    retryer = makeRetryer({
      fn: () => {
        if (!mutation.options.mutationFn) {
          return Promise.reject('No mutationFn found')
        }
        return mutation.options.mutationFn(mutation.state.variables!)
      },
      onFail: () => {
        dispatch({ type: 'failed' })
      },
      onPause: () => {
        dispatch({ type: 'pause' })
      },
      onContinue: () => {
        dispatch({ type: 'continue' })
      },
      retry: mutation.options.retry ?? 0,
      retryDelay: mutation.options.retryDelay,
    })

    return retryer.promise
  }

  function dispatch(action: Action<TData, TError, TVariables, TContext>): void {
    mutation.state = reducer(mutation.state, action)

    notifyManager.batch(() => {
      observers.forEach(observer => {
        observer.onMutationUpdate(action)
      })
      config.mutationCache.notify(mutation)
    })
  }
}

export function getDefaultState<
  TData,
  TError,
  TVariables,
  TContext
>(): MutationState<TData, TError, TVariables, TContext> {
  return {
    context: undefined,
    data: undefined,
    error: null,
    failureCount: 0,
    isPaused: false,
    status: 'idle',
    variables: undefined,
  }
}

function reducer<TData, TError, TVariables, TContext>(
  state: MutationState<TData, TError, TVariables, TContext>,
  action: Action<TData, TError, TVariables, TContext>
): MutationState<TData, TError, TVariables, TContext> {
  switch (action.type) {
    case 'failed':
      return {
        ...state,
        failureCount: state.failureCount + 1,
      }
    case 'pause':
      return {
        ...state,
        isPaused: true,
      }
    case 'continue':
      return {
        ...state,
        isPaused: false,
      }
    case 'loading':
      return {
        ...state,
        context: action.context,
        data: undefined,
        error: null,
        isPaused: false,
        status: 'loading',
        variables: action.variables,
      }
    case 'success':
      return {
        ...state,
        data: action.data,
        error: null,
        status: 'success',
        isPaused: false,
      }
    case 'error':
      return {
        ...state,
        data: undefined,
        error: action.error,
        failureCount: state.failureCount + 1,
        isPaused: false,
        status: 'error',
      }
    case 'setState':
      return {
        ...state,
        ...action.state,
      }
    default:
      return state
  }
}
