import { focusManager } from './focusManager'
import { onlineManager } from './onlineManager'
import { functionalUpdate, sleep } from './utils'

// TYPES

interface RetryerGenerics {
  Data?: unknown
  Error?: unknown
}

interface RetryerConfig<TGenerics extends RetryerGenerics> {
  onError?: (error: TGenerics['Error']) => void
  onSuccess?: (data: TGenerics['Data']) => void
  fn: () => TGenerics['Data'] | Promise<TGenerics['Data']>
  onFail?: (failureCount: number, error: TGenerics['Error']) => void
  onPause?: () => void
  onContinue?: () => void
  retry?: RetryValue<TGenerics['Error']>
  retryDelay?: RetryDelayValue
}

export type RetryValue<TError> = boolean | number | ShouldRetryFunction<TError>

type ShouldRetryFunction<TError = unknown> = (
  failureCount: number,
  error: TError
) => boolean

export type RetryDelayValue = number | RetryDelayFunction

type RetryDelayFunction = (failureCount: number) => number

function defaultRetryDelay(failureCount: number) {
  return Math.min(1000 * 2 ** failureCount, 30000)
}

interface Cancelable {
  cancel(): void
}

export function isCancelable(value: any): value is Cancelable {
  return typeof value?.cancel === 'function'
}

export interface CancelOptions {
  revert?: boolean
  silent?: boolean
}

export class CancelledError {
  revert?: boolean
  silent?: boolean
  constructor(options?: CancelOptions) {
    this.revert = options?.revert
    this.silent = options?.silent
  }
}

export function isCancelledError(value: any): value is CancelledError {
  return value instanceof CancelledError
}

export type Retryer<TGenerics extends RetryerGenerics> = {
  cancel(cancelOptions?: CancelOptions): void
  cancelRetry(): void
  failureCount: number
  isPaused: boolean
  isResolved: boolean
  isTransportCancelable: boolean
  promise: Promise<TGenerics['Data']>
  proceed(): void
}

export function createRetryer<TGenerics extends RetryerGenerics>(
  config: RetryerConfig<TGenerics>
) {
  let isRetryCancelled = false
  let cancelFn: ((options?: CancelOptions) => void) | undefined
  let continueFn: ((value?: unknown) => void) | undefined
  let promiseResolve: (data: TGenerics['Data']) => void
  let promiseReject: (error: TGenerics['Error']) => void

  const retryer: Retryer<TGenerics> = {
    cancel: cancelOptions => cancelFn?.(cancelOptions),
    cancelRetry: () => {
      isRetryCancelled = true
    },
    failureCount: 0,
    isPaused: false,
    isResolved: false,
    isTransportCancelable: false,
    promise: new Promise<TGenerics['Data']>((outerResolve, outerReject) => {
      promiseResolve = outerResolve
      promiseReject = outerReject
    }),
    proceed: () => {
      continueFn?.()
    },
  }

  const pause = () => {
    return new Promise(continueResolve => {
      continueFn = continueResolve
      retryer.isPaused = true
      config.onPause?.()
    }).then(() => {
      continueFn = undefined
      retryer.isPaused = false
      config.onContinue?.()
    })
  }

  const resolve = (value: any) => {
    if (!retryer.isResolved) {
      retryer.isResolved = true
      config.onSuccess?.(value)
      continueFn?.()
      promiseResolve(value)
    }
  }

  const reject = (value: any) => {
    if (!retryer.isResolved) {
      retryer.isResolved = true
      config.onError?.(value)
      continueFn?.()
      promiseReject(value)
    }
  }

  // Create loop function
  const run = () => {
    // Do nothing if already resolved
    if (retryer.isResolved) {
      return
    }
    let promiseOrValue: any
    // Execute query
    try {
      promiseOrValue = config.fn()
    } catch (error) {
      promiseOrValue = Promise.reject(error)
    }

    // Execute query
    try {
      promiseOrValue = config.fn()
    } catch (error) {
      promiseOrValue = Promise.reject(error)
    }

    // Create callback to cancel retryer fetch
    cancelFn = cancelOptions => {
      if (!retryer.isResolved) {
        reject(new CancelledError(cancelOptions))

        // Cancel transport if supported
        if (isCancelable(promiseOrValue)) {
          try {
            promiseOrValue.cancel()
          } catch {}
        }
      }
    }

    // Check if the transport layer support cancellation
    retryer.isTransportCancelable = isCancelable(promiseOrValue)

    Promise.resolve(promiseOrValue)
      .then(resolve)
      .catch(error => {
        // Stop if the fetch is already resolved
        if (retryer.isResolved) {
          return
        }

        // Do we need to retry the request?
        const retry = config.retry ?? 3
        const retryDelay = config.retryDelay ?? defaultRetryDelay
        const delay = functionalUpdate(retryDelay, retryer.failureCount) || 0
        const shouldRetry =
          retry === true ||
          (typeof retry === 'number' && retryer.failureCount < retry) ||
          (typeof retry === 'function' && retry(retryer.failureCount, error))

        if (isRetryCancelled || !shouldRetry) {
          // We are done if the query does not need to be retried
          reject(error)
          return
        }

        retryer.failureCount++

        // Notify on fail
        config.onFail?.(retryer.failureCount, error)

        // Delay
        sleep(delay)
          // Pause if the document is not visible or when the device is offline
          .then(() => {
            if (!focusManager.isFocused() || !onlineManager.isOnline()) {
              return pause()
            }
          })
          .then(() => {
            if (isRetryCancelled) {
              reject(error)
            } else {
              run()
            }
          })
      })
  }

  // Start loop
  run()

  return retryer
}
