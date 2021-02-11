import type { MutationGenerics, MutationOptions } from './types'
import type { QueryClient } from './queryClient'
import { notifyManager } from './notifyManager'
import { createMutation, Mutation, MutationState } from './mutation'
import { noop } from './utils'
import { Subscribable } from './subscribable'

// TYPES

interface MutationCacheConfig {
  onError?: <TMutation extends Mutation<any>>(
    error: unknown,
    variables: unknown,
    context: unknown,
    mutation: TMutation
  ) => void
}

type MutationCacheListener = (mutation?: Mutation<any>) => void

export type MutationCache = {
  config: MutationCacheConfig
  build<TGenerics extends MutationGenerics>(
    client: QueryClient,
    options: MutationOptions<TGenerics>,
    state?: MutationState<TGenerics>
  ): Mutation<TGenerics>
  add<TGenerics extends MutationGenerics>(mutation: Mutation<TGenerics>): void
  remove(mutation: Mutation<any>): void
  clear(): void
  getAll<TGenerics extends MutationGenerics>(): Mutation<TGenerics>[]
  notify(mutation?: Mutation<any>): void
  onFocus(): void
  onOnline(): void
  resumePausedMutations(): Promise<void>
}

export function createMutationCache(userConfig?: MutationCacheConfig) {
  let mutations: Mutation<any>[] = []
  let mutationId = 0

  const subscribable = Subscribable<MutationCacheListener>()

  const mutationCache: MutationCache = {
    config: userConfig || {},
    build<TGenerics extends MutationGenerics>(
      client: QueryClient,
      options: MutationOptions<TGenerics>,
      state?: MutationState<TGenerics>
    ): Mutation<TGenerics> {
      const mutation = createMutation<TGenerics>({
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
