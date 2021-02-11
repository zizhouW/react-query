import React from 'react'

import { notifyManager } from '../core/notifyManager'
import { noop } from '../core/utils'
import {
  createMutationObserver,
  MutationObserver,
} from '../core/mutationObserver'
import { useQueryClient } from './QueryClientProvider'
import { UseMutateFunction, UseMutationResult } from './types'
import {
  MutationGenerics,
  MutationObserverResult,
  MutationOptions,
} from '../core/types'
import { useIsMounted } from './useIsMounted'

// HOOK

export function useMutation<TGenerics extends MutationGenerics>(
  options: MutationOptions<TGenerics>
): UseMutationResult<TGenerics> {
  const isMounted = useIsMounted()
  const queryClient = useQueryClient()

  // Create mutation observer
  const observerRef = React.useRef<MutationObserver<TGenerics>>()
  const observer =
    observerRef.current || createMutationObserver(queryClient, options)
  observerRef.current = observer

  // Update options
  if (observer.hasListeners()) {
    observer.setOptions(options)
  }

  const [currentResult, setCurrentResult] = React.useState(() =>
    observer.getCurrentResult()
  )

  // Subscribe to the observer
  React.useEffect(
    () =>
      observer.subscribe(
        notifyManager.batchCalls(
          (result: MutationObserverResult<TGenerics>) => {
            if (isMounted()) {
              setCurrentResult(result)
            }
          }
        )
      ),
    [observer, isMounted]
  )

  const mutate = React.useCallback<UseMutateFunction<TGenerics>>(
    (variables, mutateOptions) => {
      observer.mutate(variables, mutateOptions).catch(noop)
    },
    [observer]
  )

  if (currentResult.error && observer.options.useErrorBoundary) {
    throw currentResult.error
  }

  return { ...currentResult, mutate, mutateAsync: currentResult.mutate }
}
