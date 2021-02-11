import React from 'react'

import {
  QueryGenerics,
  QueryObserverOptions,
  QueryObserverResult,
} from '../core/types'
import { notifyManager } from '../core/notifyManager'
import { createQueriesObserver, QueriesObserver } from '../core/queriesObserver'
import { useQueryClient } from './QueryClientProvider'
import { useIsMounted } from './useIsMounted'

export function useQueries<TGenerics extends QueryGenerics>(
  queries: QueryObserverOptions<TGenerics>[]
): QueryObserverResult<TGenerics>[] {
  const isMounted = useIsMounted()
  const queryClient = useQueryClient()

  // Create queries observer
  const observerRef = React.useRef<QueriesObserver<TGenerics>>()
  const observer =
    observerRef.current || createQueriesObserver(queryClient, queries)
  observerRef.current = observer

  // Update queries
  if (observer.hasListeners()) {
    observer.setQueries(queries)
  }

  const [currentResult, setCurrentResult] = React.useState(() =>
    observer.getCurrentResult()
  )

  // Subscribe to the observer
  React.useEffect(
    () =>
      observer.subscribe(
        notifyManager.batchCalls((result: QueryObserverResult<TGenerics>[]) => {
          if (isMounted()) {
            setCurrentResult(result)
          }
        })
      ),
    [observer, isMounted]
  )

  return currentResult
}
