import { sleep, queryKey, mockConsoleError } from '../../react/tests/utils'
import { QueryCache, QueryClient, makeQueryClient } from '../..'
import { makeQueryObserver } from '../queryObserver'

describe('queryClient', () => {
  let queryClient: QueryClient
  let queryCache: QueryCache

  beforeEach(() => {
    queryClient = makeQueryClient()
    queryCache = queryClient.getQueryCache()
    queryClient.mount()
  })

  afterEach(() => {
    queryClient.clear()
  })

  describe('defaultOptions', () => {
    test('should merge defaultOptions', async () => {
      const key = queryKey()

      const queryFn = () => 'data'
      const testClient = makeQueryClient({
        defaultOptions: { queries: { queryFn } },
      })

      expect(() => testClient.prefetchQuery({ queryKey: key })).not.toThrow()
    })

    test('should merge defaultOptions when query is added to cache', async () => {
      const key = queryKey()

      const testClient = makeQueryClient({
        defaultOptions: {
          queries: { cacheTime: Infinity },
        },
      })

      const fetchData = () => Promise.resolve(undefined)
      await testClient.prefetchQuery({ queryKey: key, queryFn: fetchData })
      const newQuery = testClient.getQueryCache().find({ queryKey: key })
      expect(newQuery?.options.cacheTime).toBe(Infinity)
    })
  })

  describe('setQueryDefaults', () => {
    test('should not trigger a fetch', async () => {
      const key = queryKey()
      queryClient.setQueryDefaults(key, { queryFn: () => 'data' })
      await sleep(1)
      const data = queryClient.getQueryData({ queryKey: key })
      expect(data).toBeUndefined()
    })

    test('should be able to override defaults', async () => {
      const key = queryKey()
      queryClient.setQueryDefaults(key, { queryFn: () => 'data' })
      const observer = makeQueryObserver(queryClient, { queryKey: key })
      const { data } = await observer.refetch()
      expect(data).toBe('data')
    })

    test('should match the query key partially', async () => {
      const key = queryKey()
      queryClient.setQueryDefaults([key], { queryFn: () => 'data' })
      const observer = makeQueryObserver(queryClient, {
        queryKey: [key, 'a'],
      })
      const { data } = await observer.refetch()
      expect(data).toBe('data')
    })

    test('should not match if the query key is a subset', async () => {
      const consoleMock = mockConsoleError()
      const key = queryKey()
      queryClient.setQueryDefaults([key, 'a'], { queryFn: () => 'data' })
      const observer = makeQueryObserver(queryClient, {
        queryKey: [key],
        retry: false,
        enabled: false,
      })
      const { status } = await observer.refetch()
      expect(status).toBe('error')
      consoleMock.mockRestore()
    })

    test('should also set defaults for observers', async () => {
      const key = queryKey()
      queryClient.setQueryDefaults(key, {
        queryFn: () => 'data',
        enabled: false,
      })
      const observer = makeQueryObserver(queryClient, {
        queryKey: [key],
      })
      expect(observer.getCurrentResult().status).toBe('idle')
    })
  })

  describe('setQueryData', () => {
    test('should not crash if query could not be found', () => {
      const key = queryKey()
      const user = { userId: 1 }
      expect(() => {
        queryClient.setQueryData([key, user], (prevUser?: typeof user) => ({
          ...prevUser!,
          name: 'Edvin',
        }))
      }).not.toThrow()
    })

    test('should not crash when variable is null', () => {
      const key = queryKey()
      queryClient.setQueryData([key, { userId: null }], 'Old Data')
      expect(() => {
        queryClient.setQueryData([key, { userId: null }], 'New Data')
      }).not.toThrow()
    })

    test('should use default options', () => {
      const key = queryKey()
      const testClient = makeQueryClient({
        defaultOptions: { queries: { queryKeyHashFn: () => 'someKey' } },
      })
      const testCache = testClient.getQueryCache()
      testClient.setQueryData(key, 'data')
      expect(testClient.getQueryData({ queryKey: key })).toBe('data')
      expect(testCache.find({ queryKey: key })).toBe(testCache.get('someKey'))
    })

    test('should create a new query if query was not found', () => {
      const key = queryKey()
      queryClient.setQueryData(key, 'bar')
      expect(queryClient.getQueryData({ queryKey: key })).toBe('bar')
    })

    test('should create a new query if query was not found', () => {
      const key = queryKey()
      queryClient.setQueryData(key, 'qux')
      expect(queryClient.getQueryData({ queryKey: key })).toBe('qux')
    })

    test('should accept an update function', () => {
      const key = queryKey()

      const updater = jest.fn(oldData => `new data + ${oldData}`)

      queryClient.setQueryData(key, 'test data')
      queryClient.setQueryData(key, updater)

      expect(updater).toHaveBeenCalled()
      expect(queryCache.find({ queryKey: key })!.state.data).toEqual(
        'new data + test data'
      )
    })
  })

  describe('getQueryData', () => {
    test('should return the query data if the query is found', () => {
      const key = queryKey()
      queryClient.setQueryData([key, 'id'], 'bar')
      expect(queryClient.getQueryData({ queryKey: [key, 'id'] })).toBe('bar')
    })

    test('should return undefined if the query is not found', () => {
      const key = queryKey()
      expect(queryClient.getQueryData({ queryKey: key })).toBeUndefined()
    })

    test('should match exact by default', () => {
      const key = queryKey()
      queryClient.setQueryData([key, 'id'], 'bar')
      expect(queryClient.getQueryData({ queryKey: [key] })).toBeUndefined()
    })
  })

  describe('fetchQuery', () => {
    // https://github.com/tannerlinsley/react-query/issues/652
    test('should not retry by default', async () => {
      const consoleMock = mockConsoleError()

      const key = queryKey()

      await expect(
        queryClient.fetchQuery({
          queryKey: key,
          queryFn: async () => {
            throw new Error('error')
          },
        })
      ).rejects.toEqual(new Error('error'))

      consoleMock.mockRestore()
    })

    test('should return the cached data on cache hit', async () => {
      const key = queryKey()

      const fetchFn = () => Promise.resolve('data')
      const first = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: fetchFn,
      })
      const second = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: fetchFn,
      })

      expect(second).toBe(first)
    })

    test('should be able to fetch when cache time is set to 0 and then be removed', async () => {
      const key1 = queryKey()
      const result = await queryClient.fetchQuery({
        queryKey: key1,
        queryFn: async () => {
          await sleep(10)
          return 1
        },
        cacheTime: 0,
      })
      const result2 = queryClient.getQueryData({ queryKey: key1 })
      expect(result).toEqual(1)
      expect(result2).toEqual(undefined)
    })

    test('should keep a query in cache if cache time is Infinity', async () => {
      const key1 = queryKey()
      const result = await queryClient.fetchQuery({
        queryKey: key1,
        queryFn: async () => {
          await sleep(10)
          return 1
        },
        cacheTime: Infinity,
      })
      const result2 = queryClient.getQueryData({ queryKey: key1 })
      expect(result).toEqual(1)
      expect(result2).toEqual(1)
    })

    test('should not force fetch', async () => {
      const key = queryKey()

      queryClient.setQueryData(key, 'og')
      const fetchFn = () => Promise.resolve('new')
      const first = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: fetchFn,
        initialData: 'initial',
        staleTime: 100,
      })
      expect(first).toBe('og')
    })

    test('should only fetch if the data is older then the given stale time', async () => {
      const key = queryKey()

      let count = 0
      const fetchFn = () => ++count

      queryClient.setQueryData(key, count)
      const first = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: fetchFn,
        staleTime: 100,
      })
      await sleep(11)
      const second = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: fetchFn,
        staleTime: 10,
      })
      const third = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: fetchFn,
        staleTime: 10,
      })
      await sleep(11)
      const fourth = await queryClient.fetchQuery({
        queryKey: key,
        queryFn: fetchFn,
        staleTime: 10,
      })
      expect(first).toBe(0)
      expect(second).toBe(1)
      expect(third).toBe(1)
      expect(fourth).toBe(2)
    })
  })

  describe('fetchInfiniteQuery', () => {
    test('should return infinite query data', async () => {
      const key = queryKey()
      const result = await queryClient.fetchInfiniteQuery({
        queryKey: key,
        queryFn: ({ pageParam = 10 }) => Number(pageParam),
      })
      const result2 = queryClient.getQueryData({ queryKey: key })

      const expected = {
        pages: [10],
        pageParams: [undefined],
      }

      expect(result).toEqual(expected)
      expect(result2).toEqual(expected)
    })
  })

  describe('prefetchInfiniteQuery', () => {
    test('should return infinite query data', async () => {
      const key = queryKey()

      await queryClient.prefetchInfiniteQuery({
        queryKey: key,
        queryFn: ({ pageParam = 10 }) => Number(pageParam),
      })

      const result = queryClient.getQueryData({ queryKey: key })

      expect(result).toEqual({
        pages: [10],
        pageParams: [undefined],
      })
    })
  })

  describe('prefetchQuery', () => {
    test('should return undefined when an error is thrown', async () => {
      const consoleMock = mockConsoleError()

      const key = queryKey()

      const result = await queryClient.prefetchQuery({
        queryKey: key,
        queryFn: async () => {
          throw new Error('error')
        },
        retry: false,
      })

      expect(result).toBeUndefined()
      expect(consoleMock).toHaveBeenCalled()

      consoleMock.mockRestore()
    })
  })

  describe('removeQueries', () => {
    test('should not crash when exact is provided', async () => {
      const key = queryKey()

      const fetchFn = () => Promise.resolve('data')

      // check the query was added to the cache
      await queryClient.prefetchQuery({ queryKey: key, queryFn: fetchFn })
      expect(queryCache.find({ queryKey: key })).toBeTruthy()

      // check the error doesn't occur
      expect(() =>
        queryClient.removeQueries({ queryKey: key, exact: true })
      ).not.toThrow()

      // check query was successful removed
      expect(queryCache.find({ queryKey: key })).toBeFalsy()
    })
  })

  describe('cancelQueries', () => {
    test('should revert queries to their previous state', async () => {
      const consoleMock = mockConsoleError()
      const key1 = queryKey()
      const key2 = queryKey()
      const key3 = queryKey()
      await queryClient.fetchQuery({
        queryKey: key1,
        queryFn: async () => {
          return 'data'
        },
      })
      try {
        await queryClient.fetchQuery({
          queryKey: key2,
          queryFn: async () => {
            return Promise.reject('err')
          },
        })
      } catch {}
      queryClient.fetchQuery({
        queryKey: key1,
        queryFn: async () => {
          await sleep(1000)
          return 'data2'
        },
      })
      try {
        queryClient.fetchQuery({
          queryKey: key2,
          queryFn: async () => {
            await sleep(1000)
            return Promise.reject('err2')
          },
        })
      } catch {}
      queryClient.fetchQuery({
        queryKey: key3,
        queryFn: async () => {
          await sleep(1000)
          return 'data3'
        },
      })
      await sleep(10)
      await queryClient.cancelQueries()
      const state1 = queryClient.getQueryState({ queryKey: key1 })
      const state2 = queryClient.getQueryState({ queryKey: key2 })
      const state3 = queryClient.getQueryState({ queryKey: key3 })
      expect(state1).toMatchObject({
        data: 'data',
        status: 'success',
      })
      expect(state2).toMatchObject({
        data: undefined,
        error: 'err',
        status: 'error',
      })
      expect(state3).toMatchObject({
        data: undefined,
        status: 'idle',
      })
      consoleMock.mockRestore()
    })
  })

  describe('refetchQueries', () => {
    test('should refetch all queries when no arguments are given', async () => {
      const key1 = queryKey()
      const key2 = queryKey()
      const queryFn1 = jest.fn()
      const queryFn2 = jest.fn()
      await queryClient.fetchQuery({ queryKey: key1, queryFn: queryFn1 })
      await queryClient.fetchQuery({ queryKey: key2, queryFn: queryFn2 })
      const observer1 = makeQueryObserver(queryClient, {
        queryKey: key1,
        enabled: false,
      })
      const observer2 = makeQueryObserver(queryClient, {
        queryKey: key1,
        enabled: false,
      })
      observer1.subscribe()
      observer2.subscribe()
      await queryClient.refetchQueries()
      observer1.destroy()
      observer2.destroy()
      expect(queryFn1).toHaveBeenCalledTimes(2)
      expect(queryFn2).toHaveBeenCalledTimes(2)
    })

    test('should be able to refetch all fresh queries', async () => {
      const key1 = queryKey()
      const key2 = queryKey()
      const queryFn1 = jest.fn()
      const queryFn2 = jest.fn()
      await queryClient.fetchQuery({ queryKey: key1, queryFn: queryFn1 })
      await queryClient.fetchQuery({ queryKey: key2, queryFn: queryFn2 })
      const observer = makeQueryObserver(queryClient, {
        queryKey: key1,
        queryFn: queryFn1,
        staleTime: Infinity,
      })
      const unsubscribe = observer.subscribe()
      await queryClient.refetchQueries({ active: true, stale: false })
      unsubscribe()
      expect(queryFn1).toHaveBeenCalledTimes(2)
      expect(queryFn2).toHaveBeenCalledTimes(1)
    })

    test('should be able to refetch all stale queries', async () => {
      const key1 = queryKey()
      const key2 = queryKey()
      const queryFn1 = jest.fn()
      const queryFn2 = jest.fn()
      await queryClient.fetchQuery({ queryKey: key1, queryFn: queryFn1 })
      await queryClient.fetchQuery({ queryKey: key2, queryFn: queryFn2 })
      const observer = makeQueryObserver(queryClient, {
        queryKey: key1,
        queryFn: queryFn1,
      })
      const unsubscribe = observer.subscribe()
      queryClient.invalidateQueries({ queryKey: key1 })
      await queryClient.refetchQueries({ stale: true })
      unsubscribe()
      expect(queryFn1).toHaveBeenCalledTimes(2)
      expect(queryFn2).toHaveBeenCalledTimes(1)
    })

    test('should be able to refetch all stale and active queries', async () => {
      const key1 = queryKey()
      const key2 = queryKey()
      const queryFn1 = jest.fn()
      const queryFn2 = jest.fn()
      await queryClient.fetchQuery({ queryKey: key1, queryFn: queryFn1 })
      await queryClient.fetchQuery({ queryKey: key2, queryFn: queryFn2 })
      queryClient.invalidateQueries({ queryKey: key1 })
      const observer = makeQueryObserver(queryClient, {
        queryKey: key1,
        queryFn: queryFn1,
      })
      const unsubscribe = observer.subscribe()
      await queryClient.refetchQueries({ active: true, stale: true })
      unsubscribe()
      expect(queryFn1).toHaveBeenCalledTimes(2)
      expect(queryFn2).toHaveBeenCalledTimes(1)
    })

    test('should be able to refetch all active and inactive queries', async () => {
      const key1 = queryKey()
      const key2 = queryKey()
      const queryFn1 = jest.fn()
      const queryFn2 = jest.fn()
      await queryClient.fetchQuery({ queryKey: key1, queryFn: queryFn1 })
      await queryClient.fetchQuery({ queryKey: key2, queryFn: queryFn2 })
      const observer = makeQueryObserver(queryClient, {
        queryKey: key1,
        queryFn: queryFn1,
        staleTime: Infinity,
      })
      const unsubscribe = observer.subscribe()
      await queryClient.refetchQueries()
      unsubscribe()
      expect(queryFn1).toHaveBeenCalledTimes(2)
      expect(queryFn2).toHaveBeenCalledTimes(2)
    })

    test('should be able to refetch all active and inactive queries', async () => {
      const key1 = queryKey()
      const key2 = queryKey()
      const queryFn1 = jest.fn()
      const queryFn2 = jest.fn()
      await queryClient.fetchQuery({ queryKey: key1, queryFn: queryFn1 })
      await queryClient.fetchQuery({ queryKey: key2, queryFn: queryFn2 })
      const observer = makeQueryObserver(queryClient, {
        queryKey: key1,
        queryFn: queryFn1,
        staleTime: Infinity,
      })
      const unsubscribe = observer.subscribe()
      await queryClient.refetchQueries({ active: true, inactive: true })
      unsubscribe()
      expect(queryFn1).toHaveBeenCalledTimes(2)
      expect(queryFn2).toHaveBeenCalledTimes(2)
    })
  })

  describe('invalidateQueries', () => {
    test('should not refetch inactive queries by default', async () => {
      const key1 = queryKey()
      const key2 = queryKey()
      const queryFn1 = jest.fn()
      const queryFn2 = jest.fn()
      await queryClient.fetchQuery({ queryKey: key1, queryFn: queryFn1 })
      await queryClient.fetchQuery({ queryKey: key2, queryFn: queryFn2 })
      const observer = makeQueryObserver(queryClient, {
        queryKey: key1,
        enabled: false,
        staleTime: Infinity,
      })
      const unsubscribe = observer.subscribe()
      queryClient.invalidateQueries({ queryKey: key1 })
      unsubscribe()
      expect(queryFn1).toHaveBeenCalledTimes(1)
      expect(queryFn2).toHaveBeenCalledTimes(1)
    })
  })

  describe('resetQueries', () => {
    test('should notify listeners when a query is reset', async () => {
      const key = queryKey()

      const callback = jest.fn()

      await queryClient.prefetchQuery({ queryKey: key, queryFn: () => 'data' })

      queryCache.subscribe(callback)

      queryClient.resetQueries({ queryKey: key })

      expect(callback).toHaveBeenCalled()
    })

    test('should reset query', async () => {
      const key = queryKey()

      await queryClient.prefetchQuery({ queryKey: key, queryFn: () => 'data' })

      let state = queryClient.getQueryState({ queryKey: key })
      expect(state?.data).toEqual('data')
      expect(state?.status).toEqual('success')

      queryClient.resetQueries({ queryKey: key })

      state = queryClient.getQueryState({ queryKey: key })

      expect(state).toBeTruthy()
      expect(state?.data).toBeUndefined()
      expect(state?.status).toEqual('idle')
    })

    test('should reset query data to initial data if set', async () => {
      const key = queryKey()

      await queryClient.prefetchQuery({
        queryKey: key,
        queryFn: () => 'data',
        initialData: 'initial',
      })

      let state = queryClient.getQueryState({ queryKey: key })
      expect(state?.data).toEqual('data')

      queryClient.resetQueries({ queryKey: key })

      state = queryClient.getQueryState({ queryKey: key })

      expect(state).toBeTruthy()
      expect(state?.data).toEqual('initial')
    })

    test('should refetch all active queries', async () => {
      const key1 = queryKey()
      const key2 = queryKey()
      const queryFn1 = jest.fn()
      const queryFn2 = jest.fn()
      const observer1 = makeQueryObserver(queryClient, {
        queryKey: key1,
        queryFn: queryFn1,
        enabled: true,
      })
      const observer2 = makeQueryObserver(queryClient, {
        queryKey: key2,
        queryFn: queryFn2,
        enabled: false,
      })
      observer1.subscribe()
      observer2.subscribe()
      await queryClient.resetQueries()
      observer2.destroy()
      observer1.destroy()
      expect(queryFn1).toHaveBeenCalledTimes(2)
      expect(queryFn2).toHaveBeenCalledTimes(0)
    })
  })
})
