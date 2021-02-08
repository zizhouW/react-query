import { Subscribable } from './subscribable'
import { isServer, noop } from './utils'

export type FocusManager = {
  subscribe: Subscribable['subscribe']
  isFocused(): boolean
}

function createFocusManager() {
  let focused = false
  let removeEventListener: () => void = noop

  const subscribable = Subscribable({
    onSubscribe() {
      if (!removeEventListener) {
        setDefaultEventListener()
      }
    },
  })

  const focusManager: FocusManager = {
    subscribe: subscribable.subscribe,
    isFocused: () => {
      if (typeof focused === 'boolean') {
        return focused
      }

      // document global can be unavailable in react native
      if (typeof document === 'undefined') {
        return true
      }

      return [undefined, 'visible', 'prerender'].includes(
        document.visibilityState
      )
    },
  }

  return focusManager

  function setEventListener(
    setup: (onFocusHandler: () => void) => (val?: boolean) => void
  ): void {
    if (removeEventListener) {
      removeEventListener()
    }
    removeEventListener = setup((val?: boolean) => {
      if (typeof val === 'boolean') {
        setFocused(val)
      } else {
        onFocus()
      }
    })
  }

  function setFocused(val?: boolean): void {
    focused = val ?? false

    if (focused) {
      onFocus()
    }
  }

  function onFocus(): void {
    subscribable.listeners.forEach(listener => {
      listener()
    })
  }

  function setDefaultEventListener() {
    if (!isServer && window?.addEventListener) {
      setEventListener(handleOnFocus => {
        // Listen to visibillitychange and focus
        window.addEventListener('visibilitychange', handleOnFocus, false)
        window.addEventListener('focus', handleOnFocus, false)

        return () => {
          // Be sure to unsubscribe if a new handler is set
          window.removeEventListener('visibilitychange', handleOnFocus)
          window.removeEventListener('focus', handleOnFocus)
        }
      })
    }
  }
}

export const focusManager = createFocusManager()
