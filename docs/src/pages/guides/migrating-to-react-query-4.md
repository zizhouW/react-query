---
id: migrating-to-react-query-4
title: Migrating to React Query 4
---

## Overview

- Library size reductions by about ~1kb
- Migrated from class-based architecture to a more functional style to:
  - Reduce the complexity of the source code
  - Resonate more with the React and React Query ecosystem
  - Encourage more contributions
  - Reduce cognitive load for those unfamiliar with classes
  - Reduce bundle size
- Reduce overload options in the public API to:
  - Reduce the complexity of the source code
  - Unifify and reduce testing scenarios
  - Reduce cognitive load on the user
  - Encourage consistency and facilitate code-sharing/documentation/education throughout the ecosystem

## Breaking Changes

- `new QueryClient()` -> `createQueryClient()`
- `new QueryCache()` => `createQueryCache()`
- `new QueryClient()` => `createQueryClient()`
- `new QueryObserver()` => `createQueryObserver()`
- `new QueriesObserver()` => `createQueriesObserver()`
- `new InfiniteQueryObserver()` => `createInfiniteQueryObserver()`
- `new MutationCache()` => `createMutationCache()`
- `new MutationObserver()` => `createMutationObserver()`
- The following functions:

  - `useQuery`
  - `useQueries`
  - `useInfiniteQuery`
  - `queryClient.fetchInfiniteQuery`
  - `queryClient.fetchQuery`

  no longer support the following overloads:

  ```js
  fn(queryKey, queryOptions)
  fn(queryKey, queryFn, queryOptions)
  ```

  And now require a single query configuration object with the following properties:

  ```js
  fn({
    queryKey: QueryKey,
    queryFn: QueryFunction,
    // All other existing QueryOptions properties
    ...options,
  })
  ```

- The following getter methods:

  - useIsFetching
  - queryClient.removeQueries
  - queryClient.resetQueries
  - queryClient.cancelQueries
  - queryClient.invalidateQueries
  - queryClient.refetchQueries
  - queryCache.find
  - queryCache.findAll

  no longer accept a `fn(queryKey)` as the only parameter and now require that you pass a query filter object:

  ```js
  {
    queryKey?: QueryKey
    exact?: boolean
    active?: boolean
    inactive?: boolean
    stale?: boolean
    fetching?: boolean
    predicate?: (query: Query) => boolean
  }
  ```

  For most developers, this will simply mean changing `fn(queryKey)` to `fn({ queryKey: yourQueryKey })`

- `useMutation` no longer accepts the following overload:

  ```js
  useMutation(mutationFn, mutationOptions)
  ```

  And now requires a single mutation configuration object with the following properties:

  ```js
  {
    mutationFn?: MutationFunction
    // All other existing MutationOptions properties
    ...options
  }
  ```
