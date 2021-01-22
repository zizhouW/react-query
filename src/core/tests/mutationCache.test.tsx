import { queryKey, mockConsoleError } from '../../react/tests/utils'
import { makeMutationCache, makeQueryClient } from '../..'

describe('mutationCache', () => {
  describe('MutationCacheConfig.onError', () => {
    test('should be called when a mutation errors', async () => {
      const consoleMock = mockConsoleError()
      const key = queryKey()
      const onError = jest.fn()
      const testCache = makeMutationCache({ onError })
      const testClient = makeQueryClient({ mutationCache: testCache })

      try {
        await testClient.executeMutation({
          mutationKey: key,
          variables: 'vars',
          mutationFn: () => Promise.reject('error'),
          onMutate: () => 'context',
        })
      } catch {
        consoleMock.mockRestore()
      }

      const mutation = testCache.getAll()[0]
      expect(onError).toHaveBeenCalledWith('error', 'vars', 'context', mutation)
    })
  })
})
