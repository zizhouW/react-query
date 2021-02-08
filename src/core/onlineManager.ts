import { Subscribable } from './subscribable'
import { isServer, noop } from './utils'

export type OnlineManager = {
  subscribe: Subscribable
  isOnline(): boolean
  setOnline(val?: boolean): void
}

function OnlineManager() {
  let online = false
  let removeEventListener: () => void = noop

  const subscribable = Subscribable({
    onSubscribe() {
      if (!removeEventListener) {
        setDefaultEventListener()
      }
    },
  })

  const onlineManager = {
    subscribe: subscribable.subscribe,
    isOnline: () => {
      if (typeof online === 'boolean') {
        return online
      }

      if (
        typeof navigator === 'undefined' ||
        typeof navigator.onLine === 'undefined'
      ) {
        return true
      }

      return navigator.onLine
    },
    setOnline: (val?: boolean): void => {
      online = val ?? false

      if (online) {
        onOnline()
      }
    },
  }

  return onlineManager

  function onOnline(): void {
    subscribable.listeners.forEach(listener => {
      listener()
    })
  }

  function setEventListener(
    setup: (handler: () => void) => (val?: boolean) => void
  ): void {
    if (removeEventListener) {
      removeEventListener()
    }

    removeEventListener = setup((val?: boolean) => {
      if (typeof val === 'boolean') {
        onlineManager.setOnline(val)
      } else {
        onOnline()
      }
    })
  }

  function setDefaultEventListener() {
    if (!isServer && window?.addEventListener) {
      setEventListener(handleOnlineChange => {
        // Listen to online
        window.addEventListener('online', handleOnlineChange, false)
        window.addEventListener('offline', handleOnlineChange, false)

        return () => {
          // Be sure to unsubscribe if a new handler is set
          window.removeEventListener('online', handleOnlineChange)
          window.removeEventListener('offline', handleOnlineChange)
        }
      })
    }
  }
}

export const onlineManager = OnlineManager()
