import type { PushPayload, PushSubscriptionRowInput } from './push'

/**
 * Worker-side Web Push transport (#149). Encrypts a payload for one stored
 * subscription with `@block65/webcrypto-web-push` (pure WebCrypto, no Node
 * built-ins, so it builds + runs on Cloudflare Workers) and POSTs it to the
 * push service `endpoint`.
 *
 * Kept as its own thin module so the send can be MOCKED in tests (no real VAPID
 * keys, no network) while the planning + payload shaping stay pure in push.ts.
 */

export interface VapidConfig {
  subject: string
  publicKey: string
  privateKey: string
}

/** The minimal subscription shape the send needs (the stored row columns). */
export type StoredSubscription = Pick<
  PushSubscriptionRowInput,
  'endpoint' | 'p256dh' | 'auth'
>

/** Outcome of one send: ok, or gone (404/410 = expired, prune it), or error. */
export interface SendResult {
  endpoint: string
  status: 'sent' | 'gone' | 'error'
  code?: number
}

/**
 * Encrypt `payload` for `sub` and POST it to its push service. Returns a
 * classified result rather than throwing, so a single dead subscription never
 * aborts a batch send. A 404/410 means the browser dropped the subscription, so
 * the caller can prune the row.
 */
export async function sendOne(
  sub: StoredSubscription,
  payload: PushPayload,
  vapid: VapidConfig,
): Promise<SendResult> {
  try {
    // Dynamic import keeps the WebCrypto lib out of any non-server bundle graph
    // (the client build follows static imports even through server-fn modules).
    const { buildPushPayload } = await import('@block65/webcrypto-web-push')
    const request = await buildPushPayload(
      {
        // The payload is a flat { title, body, url } record; spread into a plain
        // object so it satisfies the lib's Jsonifiable index-signature constraint.
        data: { ...payload },
        options: { ttl: 60 * 60 * 24, urgency: 'normal' },
      },
      {
        endpoint: sub.endpoint,
        expirationTime: null,
        keys: { auth: sub.auth, p256dh: sub.p256dh },
      },
      {
        subject: vapid.subject,
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    )
    const res = await fetch(sub.endpoint, {
      method: request.method,
      headers: request.headers,
      // The lib types body as its own Uint8Array; BodyInit accepts a Uint8Array
      // at runtime, the cast just bridges the structural buffer-type mismatch.
      body: request.body as BodyInit,
    })
    if (res.status === 404 || res.status === 410) {
      return { endpoint: sub.endpoint, status: 'gone', code: res.status }
    }
    if (!res.ok) {
      return { endpoint: sub.endpoint, status: 'error', code: res.status }
    }
    return { endpoint: sub.endpoint, status: 'sent', code: res.status }
  } catch {
    return { endpoint: sub.endpoint, status: 'error' }
  }
}
