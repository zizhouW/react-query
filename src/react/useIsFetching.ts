import React from 'react'

import { notifyManager } from '../core/notifyManager'
import { QueryFilters } from '../core/utils'
import { useQueryClient } from './QueryClientProvider'
import { useIsMounted } from './useIsMounted'

export function useIsFetching(filters?: QueryFilters): number {
  const isMounted = useIsMounted()
  const queryClient = useQueryClient()
  const [isFetching, setIsFetching] = React.useState(
    queryClient.isFetching(filters)
  )

  const filtersRef = React.useRef(filters)
  filtersRef.current = filters
  const isFetchingRef = React.useRef(isFetching)
  isFetchingRef.current = isFetching

  React.useEffect(
    () =>
      queryClient.getQueryCache().subscribe(
        notifyManager.batchCalls(() => {
          if (isMounted()) {
            const newIsFetching = queryClient.isFetching(filtersRef.current)
            if (isFetchingRef.current !== newIsFetching) {
              setIsFetching(newIsFetching)
            }
          }
        })
      ),
    [queryClient, isMounted]
  )

  return isFetching
}
