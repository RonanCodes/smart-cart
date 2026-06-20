import { useCallback, useEffect, useState } from 'react'
import {
  pushSupported,
  registerServiceWorker,
  urlBase64ToUint8Array,
} from '#/lib/push-client'
import { getPushConfig, subscribePush } from '#/lib/push-server'
import { log } from '#/lib/log'

/**
 * The lifecycle of a browser push opt-in (#149, extracted in #204):
 *
 *   - 'checking'     — running the support + existing-subscription + config probe.
 *   - 'unsupported'  — this browser can't do service-worker push at all.
 *   - 'unconfigured' — the server has no VAPID public key set, so nobody can subscribe.
 *   - 'denied'       — the user blocked notifications (browser-level; we can't re-prompt).
 *   - 'idle'         — supported, configured, not yet subscribed; `enable()` will prompt.
 *   - 'subscribing'  — permission/subscribe/server-store in flight.
 *   - 'subscribed'   — this browser is registered for push.
 *   - 'error'        — a step failed (SW register, subscribe, or the server fn threw).
 *
 * 'checking' / 'unsupported' / 'unconfigured' are the "quietly hide it" states for a
 * surface that should disappear when push can't work; 'denied' / 'error' are the
 * "show a soft note, don't block" states for a surface that must keep the user moving
 * (the onboarding step). Each caller decides which states to render.
 */
export type PushSubscriptionState =
  | 'checking'
  | 'unsupported'
  | 'unconfigured'
  | 'idle'
  | 'subscribing'
  | 'subscribed'
  | 'denied'
  | 'error'

export interface UsePushSubscription {
  /** Where the opt-in currently stands. */
  state: PushSubscriptionState
  /**
   * Run the full opt-in: ask for Notification permission, subscribe against the
   * VAPID key, and store the subscription server-side. Safe to call only from
   * 'idle' or 'error'; a no-op otherwise. Never throws — failures land in `state`.
   */
  enable: () => Promise<void>
}

/**
 * Shared Web Push subscribe flow, used by both the Week-page opt-in
 * (RatingReminders) and the onboarding "stay in the loop" step. One implementation
 * of permission -> subscribe -> server-store so the two surfaces can't drift.
 *
 * Fully guarded: on a browser without push it settles on 'unsupported' and never
 * touches the Notification API; with no server VAPID key it settles 'unconfigured';
 * a blocked permission settles 'denied'. `enable()` never rejects.
 */
export function usePushSubscription(): UsePushSubscription {
  const [state, setState] = useState<PushSubscriptionState>('checking')
  const [publicKey, setPublicKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      if (!pushSupported()) {
        if (!cancelled) setState('unsupported')
        return
      }
      // If this browser is already subscribed, reflect that without re-prompting.
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js')
        const existing = await reg?.pushManager.getSubscription()
        if (existing) {
          if (!cancelled) setState('subscribed')
          return
        }
      } catch {
        // fall through to the config probe
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

  const enable = useCallback(async () => {
    if (!publicKey) return
    setState('subscribing')
    log.info('push.enable_start')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        log.info('push.permission_not_granted', { permission })
        setState(permission === 'denied' ? 'denied' : 'idle')
        return
      }
      const reg = await registerServiceWorker()
      if (!reg) {
        log.error('push.sw_register_failed')
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
      log.info('push.browser_subscribed', { endpoint: sub.endpoint })
      await subscribePush({ data: { subscription: sub.toJSON() } })
      log.info('push.enable_ok')
      setState('subscribed')
    } catch (err) {
      // The bare catch used to swallow this — now we capture WHY it failed
      // (browser subscribe vs the server store) in Workers Logs.
      log.error('push.enable_failed', err)
      setState('error')
    }
  }, [publicKey])

  return { state, enable }
}
