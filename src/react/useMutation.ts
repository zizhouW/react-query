import React from 'react'

import { notifyManager } from '../core/notifyManager'
import { noop } from '../core/utils'
import {
  makeMutationObserver,
  MutationObserver,
} from '../core/mutationObserver'
import { useQueryClient } from './QueryClientProvider'
import { UseMutateFunction, UseMutationResult } from './types'
import { MutationObserverResult, MutationOptions } from '../core/types'
import { useIsMounted } from './useIsMounted'

// HOOK

export function useMutation<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown
>(
  options: MutationOptions<TData, TError, TVariables, TContext>
): UseMutationResult<TData, TError, TVariables, TContext> {
  const isMounted = useIsMounted()
  const queryClient = useQueryClient()

  // Create mutation observer
  const observerRef = React.useRef<
    MutationObserver<TData, TError, TVariables, TContext>
  >()
  const observer =
    observerRef.current || makeMutationObserver(queryClient, options)
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
          (
            result: MutationObserverResult<TData, TError, TVariables, TContext>
          ) => {
            if (isMounted()) {
              setCurrentResult(result)
            }
          }
        )
      ),
    [observer, isMounted]
  )

  const mutate = React.useCallback<
    UseMutateFunction<TData, TError, TVariables, TContext>
  >(
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
