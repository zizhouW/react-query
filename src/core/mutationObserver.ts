import { Action, getDefaultState, Mutation } from './mutation'
import { notifyManager } from './notifyManager'
import type { QueryClient } from './queryClient'
import { Subscribable } from './subscribable'
import type {
  MutateOptions,
  MutationObserverResult,
  MutationObserverOptions,
} from './types'
import { getStatusProps } from './utils'

// TYPES

type MutationObserverListener<TData, TError, TVariables, TContext> = (
  result: MutationObserverResult<TData, TError, TVariables, TContext>
) => void

interface NotifyOptions {
  listeners?: boolean
  onError?: boolean
  onSuccess?: boolean
}

export type MutationObserver<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown
> = {
  options: MutationObserverOptions<TData, TError, TVariables, TContext>
  setOptions(
    options?: MutationObserverOptions<TData, TError, TVariables, TContext>
  ): void
  onMutationUpdate(action: Action<TData, TError, TVariables, TContext>): void
  getCurrentResult(): MutationObserverResult<
    TData,
    TError,
    TVariables,
    TContext
  >
  reset(): void
  mutate(
    variables?: TVariables,
    options?: MutateOptions<TData, TError, TVariables, TContext>
  ): Promise<TData>
  subscribe: Subscribable<
    MutationObserverListener<TData, TError, TVariables, TContext>
  >['subscribe']
  hasListeners: Subscribable<
    MutationObserverListener<TData, TError, TVariables, TContext>
  >['hasListeners']
}

export function makeMutationObserver<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown
>(
  client: QueryClient,
  options: MutationObserverOptions<TData, TError, TVariables, TContext>
) {
  let currentResult: MutationObserverResult<TData, TError, TVariables, TContext>
  let currentMutation: Mutation<TData, TError, TVariables, TContext> | undefined
  let mutateOptions:
    | MutateOptions<TData, TError, TVariables, TContext>
    | undefined

  const subscribable = Subscribable<
    MutationObserverListener<TData, TError, TVariables, TContext>
  >({
    onUnsubscribe: () => {
      if (!subscribable.listeners.length) {
        currentMutation?.removeObserver(mutationObserver)
      }
    },
  })

  const mutationObserver: MutationObserver<
    TData,
    TError,
    TVariables,
    TContext
  > = {
    options,
    subscribe: subscribable.subscribe,
    hasListeners: subscribable.hasListeners,
    setOptions: newOptions => {
      mutationObserver.options = client.defaultMutationOptions(newOptions)
    },
    onMutationUpdate: action => {
      updateResult()

      // Determine which callbacks to trigger
      const notifyOptions: NotifyOptions = {
        listeners: true,
      }

      if (action.type === 'success') {
        notifyOptions.onSuccess = true
      } else if (action.type === 'error') {
        notifyOptions.onError = true
      }

      notify(notifyOptions)
    },
    getCurrentResult: () => {
      return currentResult
    },
    reset: () => {
      currentMutation = undefined
      updateResult()
      notify({ listeners: true })
    },
    mutate: (variables, newMutateOptions) => {
      mutateOptions = newMutateOptions

      if (currentMutation) {
        currentMutation.removeObserver(mutationObserver)
      }

      currentMutation = client.getMutationCache().build(client, {
        ...mutationObserver.options,
        variables:
          typeof variables !== 'undefined'
            ? variables
            : mutationObserver.options.variables,
      })

      currentMutation!.addObserver(mutationObserver)

      return currentMutation!.execute()
    },
  }

  mutationObserver.setOptions(options)
  updateResult()

  return mutationObserver

  function updateResult(): void {
    const state = currentMutation
      ? currentMutation.state
      : getDefaultState<TData, TError, TVariables, TContext>()

    currentResult = {
      ...state,
      ...getStatusProps(state.status),
      mutate: mutationObserver.mutate,
      reset: mutationObserver.reset,
    }
  }

  function notify(notifyOptions: NotifyOptions) {
    notifyManager.batch(() => {
      // First trigger the mutate callbacks
      if (mutateOptions) {
        if (notifyOptions.onSuccess) {
          mutateOptions.onSuccess?.(
            currentResult.data!,
            currentResult.variables!,
            currentResult.context!
          )
          mutateOptions.onSettled?.(
            currentResult.data!,
            null,
            currentResult.variables!,
            currentResult.context
          )
        } else if (notifyOptions.onError) {
          mutateOptions.onError?.(
            currentResult.error!,
            currentResult.variables!,
            currentResult.context
          )
          mutateOptions.onSettled?.(
            undefined,
            currentResult.error,
            currentResult.variables!,
            currentResult.context
          )
        }
      }

      // Then trigger the listeners
      if (subscribable.listeners) {
        subscribable.listeners.forEach(listener => {
          listener(currentResult)
        })
      }
    })
  }
}
