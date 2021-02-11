import { mockNavigatorOnLine, sleep } from '../../react/tests/utils'
import { createQueryCache, createQueryClient } from '../..'
import { dehydrate, hydrate } from '../hydration'

async function fetchData<TData>(
  value: TData,
  ms?: number
): Promise<TGenerics['Data']> {
  await sleep(ms || 0)
  return value
}

describe('dehydration and rehydration', () => {
  test('should work with serializeable values', async () => {
    const queryCache = createQueryCache()
    const queryClient = createQueryClient({ queryCache })
    await queryClient.prefetchQuery({
      queryKey: 'string',
      queryFn: () => fetchData('string'),
    })
    await queryClient.prefetchQuery({
      queryKey: 'number',
      queryFn: () => fetchData(1),
    })
    await queryClient.prefetchQuery({
      queryKey: 'boolean',
      queryFn: () => fetchData(true),
    })
    await queryClient.prefetchQuery({
      queryKey: 'null',
      queryFn: () => fetchData(null),
    })
    await queryClient.prefetchQuery({
      queryKey: 'array',
      queryFn: () => fetchData(['string', 0]),
    })
    await queryClient.prefetchQuery({
      queryKey: 'nested',
      queryFn: () => fetchData({ key: [{ nestedKey: 1 }] }),
    })
    const dehydrated = dehydrate(queryClient)
    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationCache = createQueryCache()
    const hydrationClient = createQueryClient({ queryCache: hydrationCache })
    hydrate(hydrationClient, parsed)
    expect(hydrationCache.find({ queryKey: 'string' })?.state.data).toBe(
      'string'
    )
    expect(hydrationCache.find({ queryKey: 'number' })?.state.data).toBe(1)
    expect(hydrationCache.find({ queryKey: 'boolean' })?.state.data).toBe(true)
    expect(hydrationCache.find({ queryKey: 'null' })?.state.data).toBe(null)
    expect(hydrationCache.find({ queryKey: 'array' })?.state.data).toEqual([
      'string',
      0,
    ])
    expect(hydrationCache.find({ queryKey: 'nested' })?.state.data).toEqual({
      key: [{ nestedKey: 1 }],
    })

    const fetchDataAfterHydration = jest.fn()
    await hydrationClient.prefetchQuery({
      queryKey: 'string',
      queryFn: fetchDataAfterHydration,
      staleTime: 1000,
    })
    await hydrationClient.prefetchQuery({
      queryKey: 'number',
      queryFn: fetchDataAfterHydration,
      staleTime: 1000,
    })
    await hydrationClient.prefetchQuery({
      queryKey: 'boolean',
      queryFn: fetchDataAfterHydration,
      staleTime: 1000,
    })
    await hydrationClient.prefetchQuery({
      queryKey: 'null',
      queryFn: fetchDataAfterHydration,
      staleTime: 1000,
    })
    await hydrationClient.prefetchQuery({
      queryKey: 'array',
      queryFn: fetchDataAfterHydration,
      staleTime: 1000,
    })
    await hydrationClient.prefetchQuery({
      queryKey: 'nested',
      queryFn: fetchDataAfterHydration,
      staleTime: 1000,
    })
    expect(fetchDataAfterHydration).toHaveBeenCalledTimes(0)

    queryClient.clear()
    hydrationClient.clear()
  })

  test('should use the cache time from the client', async () => {
    const queryCache = createQueryCache()
    const queryClient = createQueryClient({ queryCache })
    await queryClient.prefetchQuery({
      queryKey: 'string',
      queryFn: () => fetchData('string'),
      cacheTime: 50,
    })
    const dehydrated = dehydrate(queryClient)
    const stringified = JSON.stringify(dehydrated)

    await sleep(20)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationCache = createQueryCache()
    const hydrationClient = createQueryClient({ queryCache: hydrationCache })
    hydrate(hydrationClient, parsed)
    expect(hydrationCache.find({ queryKey: 'string' })?.state.data).toBe(
      'string'
    )
    await sleep(100)
    expect(hydrationCache.find({ queryKey: 'string' })).toBeTruthy()

    queryClient.clear()
    hydrationClient.clear()
  })

  test('should be able to provide default options for the hydrated queries', async () => {
    const queryCache = createQueryCache()
    const queryClient = createQueryClient({ queryCache })
    await queryClient.prefetchQuery({
      queryKey: 'string',
      queryFn: () => fetchData('string'),
    })
    const dehydrated = dehydrate(queryClient)
    const stringified = JSON.stringify(dehydrated)
    const parsed = JSON.parse(stringified)
    const hydrationCache = createQueryCache()
    const hydrationClient = createQueryClient({ queryCache: hydrationCache })
    hydrate(hydrationClient, parsed, {
      defaultOptions: { queries: { retry: 10 } },
    })
    expect(hydrationCache.find({ queryKey: 'string' })?.options.retry).toBe(10)
    queryClient.clear()
    hydrationClient.clear()
  })

  test('should work with complex keys', async () => {
    const queryCache = createQueryCache()
    const queryClient = createQueryClient({ queryCache })
    await queryClient.prefetchQuery({
      queryKey: ['string', { key: ['string'], key2: 0 }],
      queryFn: () => fetchData('string'),
    })
    const dehydrated = dehydrate(queryClient)
    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationCache = createQueryCache()
    const hydrationClient = createQueryClient({ queryCache: hydrationCache })
    hydrate(hydrationClient, parsed)
    expect(
      hydrationCache.find({
        queryKey: ['string', { key: ['string'], key2: 0 }],
      })?.state.data
    ).toBe('string')

    const fetchDataAfterHydration = jest.fn()
    await hydrationClient.prefetchQuery({
      queryKey: ['string', { key: ['string'], key2: 0 }],
      queryFn: fetchDataAfterHydration,
      staleTime: 10,
    })
    expect(fetchDataAfterHydration).toHaveBeenCalledTimes(0)

    queryClient.clear()
    hydrationClient.clear()
  })

  test('should only hydrate successful queries by default', async () => {
    const consoleMock = jest.spyOn(console, 'error')
    consoleMock.mockImplementation(() => undefined)

    const queryCache = createQueryCache()
    const queryClient = createQueryClient({ queryCache })
    await queryClient.prefetchQuery({
      queryKey: 'success',
      queryFn: () => fetchData('success'),
    })
    queryClient.prefetchQuery({
      queryKey: 'loading',
      queryFn: () => fetchData('loading', 10000),
    })
    await queryClient.prefetchQuery({
      queryKey: 'error',
      queryFn: () => {
        throw new Error()
      },
    })
    const dehydrated = dehydrate(queryClient)
    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationCache = createQueryCache()
    const hydrationClient = createQueryClient({ queryCache: hydrationCache })
    hydrate(hydrationClient, parsed)

    expect(hydrationCache.find({ queryKey: 'success' })).toBeTruthy()
    expect(hydrationCache.find({ queryKey: 'loading' })).toBeFalsy()
    expect(hydrationCache.find({ queryKey: 'error' })).toBeFalsy()

    queryClient.clear()
    hydrationClient.clear()
    consoleMock.mockRestore()
  })

  test('should filter queries via shouldDehydrateQuery', async () => {
    const queryCache = createQueryCache()
    const queryClient = createQueryClient({ queryCache })
    await queryClient.prefetchQuery({
      queryKey: 'string',
      queryFn: () => fetchData('string'),
    })
    await queryClient.prefetchQuery({
      queryKey: 'number',
      queryFn: () => fetchData(1),
    })
    const dehydrated = dehydrate(queryClient, {
      shouldDehydrateQuery: query => query.queryKey !== 'string',
    })

    // This is testing implementation details that can change and are not
    // part of the public API, but is important for keeping the payload small
    const dehydratedQuery = dehydrated?.queries.find(
      query => query?.queryKey === 'string'
    )
    expect(dehydratedQuery).toBeUndefined()

    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationCache = createQueryCache()
    const hydrationClient = createQueryClient({ queryCache: hydrationCache })
    hydrate(hydrationClient, parsed)
    expect(hydrationCache.find({ queryKey: 'string' })).toBeUndefined()
    expect(hydrationCache.find({ queryKey: 'number' })?.state.data).toBe(1)

    queryClient.clear()
    hydrationClient.clear()
  })

  test('should not overwrite query in cache if hydrated query is older', async () => {
    const queryCache = createQueryCache()
    const queryClient = createQueryClient({ queryCache })
    await queryClient.prefetchQuery({
      queryKey: 'string',
      queryFn: () => fetchData('string-older', 5),
    })
    const dehydrated = dehydrate(queryClient)
    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationCache = createQueryCache()
    const hydrationClient = createQueryClient({ queryCache: hydrationCache })
    await hydrationClient.prefetchQuery({
      queryKey: 'string',
      queryFn: () => fetchData('string-newer', 5),
    })

    hydrate(hydrationClient, parsed)
    expect(hydrationCache.find({ queryKey: 'string' })?.state.data).toBe(
      'string-newer'
    )

    queryClient.clear()
    hydrationClient.clear()
  })

  test('should overwrite query in cache if hydrated query is newer', async () => {
    const hydrationCache = createQueryCache()
    const hydrationClient = createQueryClient({ queryCache: hydrationCache })
    await hydrationClient.prefetchQuery({
      queryKey: 'string',
      queryFn: () => fetchData('string-older', 5),
    })

    // ---

    const queryCache = createQueryCache()
    const queryClient = createQueryClient({ queryCache })
    await queryClient.prefetchQuery({
      queryKey: 'string',
      queryFn: () => fetchData('string-newer', 5),
    })
    const dehydrated = dehydrate(queryClient)
    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    hydrate(hydrationClient, parsed)
    expect(hydrationCache.find({ queryKey: 'string' })?.state.data).toBe(
      'string-newer'
    )

    queryClient.clear()
    hydrationClient.clear()
  })

  test('should be able to dehydrate mutations and continue on hydration', async () => {
    const consoleMock = jest.spyOn(console, 'error')
    consoleMock.mockImplementation(() => undefined)
    mockNavigatorOnLine(false)

    const serverAddTodo = jest
      .fn()
      .mockImplementation(() => Promise.reject('offline'))
    const serverOnMutate = jest.fn().mockImplementation(variables => {
      const optimisticTodo = { id: 1, text: variables.text }
      return { optimisticTodo }
    })
    const serverOnSuccess = jest.fn()

    const serverClient = createQueryClient()

    serverClient.setMutationDefaults('addTodo', {
      mutationFn: serverAddTodo,
      onMutate: serverOnMutate,
      onSuccess: serverOnSuccess,
      retry: 3,
      retryDelay: 10,
    })

    serverClient
      .executeMutation({
        mutationKey: 'addTodo',
        variables: { text: 'text' },
      })
      .catch(() => undefined)

    await sleep(50)

    const dehydrated = dehydrate(serverClient)
    const stringified = JSON.stringify(dehydrated)

    serverClient.clear()

    // ---

    mockNavigatorOnLine(true)

    const parsed = JSON.parse(stringified)
    const client = createQueryClient()

    const clientAddTodo = jest.fn().mockImplementation(variables => {
      return { id: 2, text: variables.text }
    })
    const clientOnMutate = jest.fn().mockImplementation(variables => {
      const optimisticTodo = { id: 1, text: variables.text }
      return { optimisticTodo }
    })
    const clientOnSuccess = jest.fn()

    client.setMutationDefaults('addTodo', {
      mutationFn: clientAddTodo,
      onMutate: clientOnMutate,
      onSuccess: clientOnSuccess,
      retry: 3,
      retryDelay: 10,
    })

    hydrate(client, parsed)

    await client.resumePausedMutations()

    expect(clientAddTodo).toHaveBeenCalledTimes(1)
    expect(clientOnMutate).not.toHaveBeenCalled()
    expect(clientOnSuccess).toHaveBeenCalledTimes(1)
    expect(clientOnSuccess).toHaveBeenCalledWith(
      { id: 2, text: 'text' },
      { text: 'text' },
      { optimisticTodo: { id: 1, text: 'text' } }
    )

    client.clear()
    consoleMock.mockRestore()
  })
})
