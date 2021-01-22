import type { MutationOptions } from './types'
import type { QueryClient } from './queryClient'
import { notifyManager } from './notifyManager'
import { makeMutation, Mutation, MutationState } from './mutation'
import { noop } from './utils'
import { Subscribable } from './subscribable'

// TYPES

interface MutationCacheConfig {
  onError?: <TMutation extends Mutation<unknown, unknown, unknown, unknown>>(
    error: unknown,
    variables: unknown,
    context: unknown,
    mutation: TMutation
  ) => void
}

type MutationCacheListener = (mutation?: Mutation) => void

export type MutationCache = {
  config: MutationCacheConfig
  build<TData, TError, TVariables, TContext>(
    client: QueryClient,
    options: MutationOptions<TData, TError, TVariables, TContext>,
    state?: MutationState<TData, TError, TVariables, TContext>
  ): Mutation<TData, TError, TVariables, TContext>
  add(mutation: Mutation<any, any, any, any>): void
  remove(mutation: Mutation<any, any, any, any>): void
  clear(): void
  getAll(): Mutation[]
  notify(mutation?: Mutation<any, any, any, any>): void
  onFocus(): void
  onOnline(): void
  resumePausedMutations(): Promise<void>
}

export function makeMutationCache(userConfig?: MutationCacheConfig) {
  let mutations: Mutation<any, any, any, any>[] = []
  let mutationId = 0

  const subscribable = Subscribable<MutationCacheListener>()

  const mutationCache: MutationCache = {
    config: userConfig || {},
    build<TData, TError, TVariables, TContext>(
      client: QueryClient,
      options: MutationOptions<TData, TError, TVariables, TContext>,
      state?: MutationState<TData, TError, TVariables, TContext>
    ): Mutation<TData, TError, TVariables, TContext> {
      const mutation = makeMutation<TData, TError, TVariables, TContext>({
        mutationCache,
        mutationId: ++mutationId,
        options: client.defaultMutationOptions(options),
        state,
        defaultOptions: options.mutationKey
          ? client.getMutationDefaults(options.mutationKey)
          : undefined,
      })

      mutationCache.add(mutation)

      return mutation
    },

    add: mutation => {
      mutations.push(mutation)
      mutationCache.notify(mutation)
    },

    remove: mutation => {
      mutations = mutations.filter(x => x !== mutation)
      mutation.cancel()
      mutationCache.notify(mutation)
    },

    clear: () => {
      notifyManager.batch(() => {
        mutations.forEach(mutation => {
          mutationCache.remove(mutation)
        })
      })
    },

    getAll: () => {
      return mutations
    },

    notify: mutation => {
      notifyManager.batch(() => {
        subscribable.listeners.forEach(listener => {
          listener(mutation)
        })
      })
    },

    onFocus: () => {
      mutationCache.resumePausedMutations()
    },

    onOnline: () => {
      mutationCache.resumePausedMutations()
    },

    resumePausedMutations: () => {
      const pausedMutations = mutations.filter(x => x.state.isPaused)
      return notifyManager.batch(() =>
        pausedMutations.reduce(
          (promise, mutation) =>
            promise.then(() => mutation.continue().catch(noop)),
          Promise.resolve()
        )
      )
    },
  }

  return mutationCache
}
