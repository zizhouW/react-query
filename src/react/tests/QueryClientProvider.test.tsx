import React from 'react'
import { render, waitFor } from '@testing-library/react'

import { sleep, queryKey } from './utils'
import {
  createQueryClient,
  QueryClientProvider,
  createQueryCache,
  useQuery,
} from '../..'

describe('QueryClientProvider', () => {
  test('sets a specific cache for all queries to use', async () => {
    const key = queryKey()

    const queryCache = createQueryCache()
    const queryClient = createQueryClient({ queryCache })

    function Page() {
      const { data } = useQuery({
        queryKey: key,
        queryFn: async () => {
          await sleep(10)
          return 'test'
        },
      })

      return (
        <div>
          <h1>{data}</h1>
        </div>
      )
    }

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <Page />
      </QueryClientProvider>
    )

    await waitFor(() => rendered.getByText('test'))

    expect(queryCache.find({ queryKey: key })).toBeDefined()
  })

  test('allows multiple caches to be partitioned', async () => {
    const key1 = queryKey()
    const key2 = queryKey()

    const queryCache1 = createQueryCache()
    const queryCache2 = createQueryCache()

    const queryClient1 = createQueryClient({ queryCache: queryCache1 })
    const queryClient2 = createQueryClient({ queryCache: queryCache2 })

    function Page1() {
      const { data } = useQuery({
        queryKey: key1,
        queryFn: async () => {
          await sleep(10)
          return 'test1'
        },
      })

      return (
        <div>
          <h1>{data}</h1>
        </div>
      )
    }
    function Page2() {
      const { data } = useQuery({
        queryKey: key2,
        queryFn: async () => {
          await sleep(10)
          return 'test2'
        },
      })

      return (
        <div>
          <h1>{data}</h1>
        </div>
      )
    }

    const rendered = render(
      <>
        <QueryClientProvider client={queryClient1}>
          <Page1 />
        </QueryClientProvider>
        <QueryClientProvider client={queryClient2}>
          <Page2 />
        </QueryClientProvider>
      </>
    )

    await waitFor(() => rendered.getByText('test1'))
    await waitFor(() => rendered.getByText('test2'))

    expect(queryCache1.find({ queryKey: key1 })).toBeDefined()
    expect(queryCache1.find({ queryKey: key2 })).not.toBeDefined()
    expect(queryCache2.find({ queryKey: key1 })).not.toBeDefined()
    expect(queryCache2.find({ queryKey: key2 })).toBeDefined()
  })

  test("uses defaultOptions for queries when they don't provide their own config", async () => {
    const key = queryKey()

    const queryCache = createQueryCache()
    const queryClient = createQueryClient({
      queryCache,
      defaultOptions: {
        queries: {
          cacheTime: Infinity,
        },
      },
    })

    function Page() {
      const { data } = useQuery({
        queryKey: key,
        queryFn: async () => {
          await sleep(10)
          return 'test'
        },
      })

      return (
        <div>
          <h1>{data}</h1>
        </div>
      )
    }

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <Page />
      </QueryClientProvider>
    )

    await waitFor(() => rendered.getByText('test'))

    expect(queryCache.find({ queryKey: key })).toBeDefined()
    expect(queryCache.find({ queryKey: key })?.options.cacheTime).toBe(Infinity)
  })
})
