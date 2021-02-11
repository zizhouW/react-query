import { Action, getDefaultState, Mutation } from './mutation'
import { notifyManager } from './notifyManager'
import type { QueryClient } from './queryClient'
import { Subscribable } from './subscribable'
import type {
  MutateOptions,
  MutationObserverResult,
  MutationObserverOptions,
  MutationGenerics,
} from './types'
import { getStatusProps } from './utils'

// TYPES

type MutationObserverListener<TGenerics extends MutationGenerics> = (
  result: MutationObserverResult<TGenerics>
) => void

interface NotifyOptions {
  listeners?: boolean
  onError?: boolean
  onSuccess?: boolean
}

export type MutationObserver<TGenerics extends MutationGenerics> = {
  options: MutationObserverOptions<TGenerics>
  setOptions(options?: MutationObserverOptions<TGenerics>): void
  onMutationUpdate(action: Action<TGenerics>): void
  getCurrentResult(): MutationObserverResult<TGenerics>
  reset(): void
  mutate(
    variables?: TGenerics['Variables'],
    options?: MutateOptions<TGenerics>
  ): Promise<TGenerics['Data']>
  subscribe: Subscribable<MutationObserverListener<TGenerics>>['subscribe']
  hasListeners: Subscribable<
    MutationObserverListener<TGenerics>
  >['hasListeners']
}

export function createMutationObserver<TGenerics extends MutationGenerics>(
  client: QueryClient,
  options: MutationObserverOptions<TGenerics>
) {
  let currentResult: MutationObserverResult<TGenerics>
  let currentMutation: Mutation<TGenerics> | undefined
  let mutateOptions: MutateOptions<TGenerics> | undefined

  const subscribable = Subscribable<MutationObserverListener<TGenerics>>({
    onUnsubscribe: () => {
      if (!subscribable.listeners.length) {
        currentMutation?.removeObserver(mutationObserver)
      }
    },
  })

  const mutationObserver: MutationObserver<TGenerics> = {
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
      : getDefaultState<TGenerics>()

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
