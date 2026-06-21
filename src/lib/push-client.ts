/**
 * Browser-side Web Push helpers (#149). All of this is guarded so it is a no-op
 * in environments without the relevant APIs (SSR, older browsers, iOS Safari
 * before a home-screen install). Pure DOM + the two server fns; no Worker code.
 */

/** Whether this browser can do service-worker push at all. */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/**
 * The VAPID public key is base64url; the browser's `applicationServerKey` wants
 * a Uint8Array. Convert it, tolerating missing padding (base64url drops it).
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalised)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

/** Register the Souso service worker (idempotent — returns the existing reg if any). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null
  }
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

/**
 * One-shot push opt-in, designed to be fired from a user-gesture moment (the
 * click that completes a sign-in / sign-up). Browsers only show the Notification
 * permission prompt in response to a gesture, so this runs inline on the verify
 * success handler rather than as a separate onboarding step (#149 prompt-on-auth).
 *
 * Behaviour, in one pass:
 *   - Unsupported browser (SSR, no SW/PushManager/Notification, iOS Safari NOT
 *     installed as a PWA) -> silent no-op. Web push needs an installed PWA on iOS,
 *     so mobile Safari simply skips here with no error and no prompt.
 *   - `Notification.permission === 'denied'` -> do nothing (can't re-prompt).
 *   - `=== 'granted'` -> the user already said yes; (re)ensure the browser is
 *     subscribed and the server has the row, then return.
 *   - `=== 'default'` -> request permission; on grant, register the SW + subscribe
 *     against the VAPID key + persist server-side.
 *
 * NEVER throws and is idempotent: re-running when already subscribed is cheap and
 * safe. Callers fire-and-forget it (`void promptForNotifications()`) BEFORE the
 * post-auth redirect so the prompt surfaces, but navigation never waits on it.
 */
export async function promptForNotifications(): Promise<void> {
  try {
    if (!pushSupported()) return
    if (Notification.permission === 'denied') return

    // Lazy import so the push-server fns (and their server-only deps) only pull in
    // when we actually reach a sign-in success, not on every module load.
    const { log } = await import('./log')
    // #414 (SOUSO-Z): on iOS, when the page is already tearing down for the
    // post-auth navigation, this dynamic import can resolve to null/undefined.
    // Destructuring that threw an unhandled TypeError. Null-guard it so a torn-down
    // import is a SILENT no-op, not an error logged to Sentry.
    // The static type says the module is always present, but on iOS during page
    // teardown the dynamic import really can resolve to null/undefined. Widen to a
    // minimal nullable structural type so the runtime guard below is honest (and
    // not stripped as "always truthy" by the no-unnecessary-condition lint). We
    // deliberately avoid a static `import type` of './push-server' here: that
    // module pulls server-only code (cloudflare:workers) and must never be
    // statically referenced from this client module, even types-only.
    type PushServerModule = {
      getPushConfig: () => Promise<{ publicKey?: string }>
      subscribePush: (args: {
        data: { subscription: PushSubscriptionJSON }
      }) => Promise<unknown>
    }
    const mod = (await import('./push-server')) as
      | PushServerModule
      | null
      | undefined
    if (!mod || typeof mod.getPushConfig !== 'function') return
    const { getPushConfig, subscribePush } = mod

    const cfg = await getPushConfig()
    if (!cfg.publicKey) {
      // No VAPID public key configured server-side; nobody can subscribe. Quiet.
      log.info('push.prompt_skipped_unconfigured')
      return
    }

    if (Notification.permission === 'default') {
      log.info('push.prompt_request')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        log.info('push.prompt_not_granted', { permission })
        return
      }
    }
    // Either it was already 'granted', or the user just granted it. Ensure the
    // service worker + subscription + server row all exist (idempotent upsert).

    const reg = await registerServiceWorker()
    if (!reg) {
      log.error('push.prompt_sw_register_failed')
      return
    }
    await navigator.serviceWorker.ready

    const existing = await reg.pushManager.getSubscription()
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast bridges the Uint8Array<ArrayBufferLike> vs BufferSource mismatch;
        // a Uint8Array is a valid applicationServerKey at runtime.
        applicationServerKey: urlBase64ToUint8Array(
          cfg.publicKey,
        ) as BufferSource,
      }))

    await subscribePush({ data: { subscription: sub.toJSON() } })
    log.info('push.prompt_subscribed', { endpoint: sub.endpoint })
  } catch (err) {
    // Best-effort: a failure here must never break sign-in. Swallow after logging.
    try {
      const { log } = await import('./log')
      log.error('push.prompt_failed', err)
    } catch {
      // Logging itself failed; nothing more we can safely do.
    }
  }
}
