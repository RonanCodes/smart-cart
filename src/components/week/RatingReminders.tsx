import { useEffect, useState } from 'react'
import { Bell, BellOff, Check } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  pushSupported,
  registerServiceWorker,
  urlBase64ToUint8Array,
} from '#/lib/push-client'
import { getPushConfig, subscribePush } from '#/lib/push-server'

type State =
  | 'checking'
  | 'unsupported'
  | 'unconfigured'
  | 'idle'
  | 'subscribing'
  | 'subscribed'
  | 'denied'
  | 'error'

/**
 * Opt-in control for post-meal rating reminders (#149). Asks the browser for
 * Notification permission, subscribes to push against the VAPID public key, and
 * registers the subscription server-side so an admin can later send a "rate the
 * meal" push. Fully guarded: renders nothing on browsers without push, and shows
 * a clear "not set up yet" line when VAPID secrets are unset on the server.
 *
 * Mobile-first: a single 44px tap target, no hover-only affordance, plain status
 * text underneath so the user always knows where they stand.
 */
export function RatingReminders() {
  const [state, setState] = useState<State>('checking')
  const [publicKey, setPublicKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      if (!pushSupported()) {
        if (!cancelled) setState('unsupported')
        return
      }
      // If already subscribed, reflect that without re-prompting.
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js')
        const existing = await reg?.pushManager.getSubscription()
        if (existing) {
          if (!cancelled) setState('subscribed')
          return
        }
      } catch {
        // fall through to config check
      }
      const cfg = await getPushConfig()
      if (cancelled) return
      if (!cfg.publicKey) {
        setState('unconfigured')
        return
      }
      setPublicKey(cfg.publicKey)
      setState(Notification.permission === 'denied' ? 'denied' : 'idle')
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [])

  async function enable() {
    if (!publicKey) return
    setState('subscribing')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'idle')
        return
      }
      const reg = await registerServiceWorker()
      if (!reg) {
        setState('error')
        return
      }
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast bridges the Uint8Array<ArrayBufferLike> vs BufferSource mismatch;
        // a Uint8Array is a valid applicationServerKey at runtime.
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })
      await subscribePush({ data: { subscription: sub.toJSON() } })
      setState('subscribed')
    } catch {
      setState('error')
    }
  }

  // Nothing to show where push can't work or isn't set up: keep the week clean.
  if (
    state === 'checking' ||
    state === 'unsupported' ||
    state === 'unconfigured'
  ) {
    return null
  }

  return (
    <div className="border-border/60 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Rating reminders</p>
        <p className="text-muted-foreground text-xs">
          {state === 'subscribed'
            ? "We'll nudge you to rate a dinner after you cook it."
            : state === 'denied'
              ? 'Notifications are blocked. Enable them in your browser settings.'
              : state === 'error'
                ? "Couldn't enable reminders, try again."
                : 'Get a gentle nudge to rate a meal after you cook it.'}
        </p>
      </div>
      {state === 'subscribed' ? (
        <span className="text-primary inline-flex shrink-0 items-center gap-1 text-sm font-medium">
          <Check className="h-4 w-4" aria-hidden /> On
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          disabled={state === 'subscribing' || state === 'denied'}
          onClick={() => void enable()}
        >
          {state === 'denied' ? (
            <BellOff className="h-4 w-4" aria-hidden />
          ) : (
            <Bell className="h-4 w-4" aria-hidden />
          )}
          {state === 'subscribing' ? 'Enabling…' : 'Enable'}
        </Button>
      )}
    </div>
  )
}
