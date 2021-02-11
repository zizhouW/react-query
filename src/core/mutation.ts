import type { MutationGenerics, MutationOptions, MutationStatus } from './types'
import type { MutationCache } from './mutationCache'
import type { MutationObserver } from './mutationObserver'
import { getLogger } from './logger'
import { notifyManager } from './notifyManager'
import { createRetryer, Retryer } from './retryer'
import { noop } from './utils'

// TYPES

interface MutationConfig<TGenerics extends MutationGenerics> {
  mutationId: number
  mutationCache: MutationCache
  options: MutationOptions<TGenerics>
  defaultOptions?: MutationOptions<TGenerics>
  state?: MutationState<TGenerics>
}

export interface MutationState<TGenerics extends MutationGenerics> {
  context: TGenerics['Context'] | undefined
  data: TGenerics['Data'] | undefined
  error: TGenerics['Error'] | null
  failureCount: number
  isPaused: boolean
  status: MutationStatus
  variables: TGenerics['Variables'] | undefined
}

interface FailedAction {
  type: 'failed'
}

interface LoadingAction<TGenerics extends MutationGenerics> {
  type: 'loading'
  variables?: TGenerics['Variables']
  context?: TGenerics['Context']
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

interface SetStateAction<TGenerics extends MutationGenerics> {
  type: 'setState'
  state: MutationState<TGenerics>
}

export type Action<TGenerics extends MutationGenerics> =
  | ContinueAction
  | ErrorAction<TGenerics['Error']>
  | FailedAction
  | LoadingAction<TGenerics>
  | PauseAction
  | SetStateAction<TGenerics>
  | SuccessAction<TGenerics['Data']>

// CLASS

export type Mutation<TGenerics extends MutationGenerics> = {
  state: MutationState<TGenerics>
  options: MutationOptions<TGenerics>
  mutationId: number
  setState(state: MutationState<TGenerics>): void
  addObserver(observer: MutationObserver<TGenerics>): void
  removeObserver(observer: MutationObserver<TGenerics>): void
  cancel(): Promise<void>
  continue(): Promise<TGenerics['Data']>
  execute(): Promise<TGenerics['Data']>
}

export function createMutation<TGenerics extends MutationGenerics>(
  config: MutationConfig<TGenerics>
) {
  let observers: MutationObserver<TGenerics>[] = []
  let retryer: Retryer<TGenerics>

  const mutation: Mutation<TGenerics> = {
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
      let data: TGenerics['Data']

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
              mutation
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

  function executeMutation(): Promise<TGenerics['Data']> {
    retryer = createRetryer({
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

  function dispatch(action: Action<TGenerics>): void {
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
  TGenerics extends MutationGenerics
>(): MutationState<TGenerics> {
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

function reducer<TGenerics extends MutationGenerics>(
  state: MutationState<TGenerics>,
  action: Action<TGenerics>
): MutationState<TGenerics> {
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
