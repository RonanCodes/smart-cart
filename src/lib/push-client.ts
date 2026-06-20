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
