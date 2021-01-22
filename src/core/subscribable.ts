type Listener = () => void

interface SubscribableOptions {
  onSubscribe?: () => void
  onUnsubscribe?: () => void
}

export type Subscribable<TListener extends Function = Listener> = {
  listeners: TListener[]
  subscribe(listener?: TListener): () => void
  hasListeners(): boolean
}

export function Subscribable<TListener extends Function = Listener>({
  onSubscribe,
  onUnsubscribe,
}: SubscribableOptions = {}) {
  const subscribable: Subscribable<TListener> = {
    listeners: [],
    subscribe: listener => {
      const callback = listener || (() => undefined)

      subscribable.listeners.push(callback as TListener)

      onSubscribe?.()

      return () => {
        subscribable.listeners = subscribable.listeners.filter(
          x => x !== callback
        )
        onUnsubscribe?.()
      }
    },
    hasListeners: () => subscribable.listeners.length > 0,
  }

  return subscribable
}
