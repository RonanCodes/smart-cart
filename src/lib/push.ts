/**
 * Pure helpers for PWA Web Push (#149).
 *
 * The browser's `pushManager.subscribe()` returns a `PushSubscription` whose
 * JSON form is `{ endpoint, keys: { p256dh, auth } }`. To send a notification
 * the Worker needs those three values stored as a row. The notification itself
 * is a small JSON payload `{ title, body, url }` the service worker reads in its
 * `push` handler to show the notification and to know where to open on tap.
 *
 * Everything here is pure (no DB, no Worker, no WebCrypto) so it runs identically
 * in unit tests and inside the server fn. The actual encrypt-and-send lives in
 * push-server.ts behind a dynamic import so no Worker-only code leaks to the
 * client bundle.
 */

/** The JSON shape a browser PushSubscription serialises to. */
export interface PushSubscriptionJson {
  endpoint?: string
  keys?: {
    p256dh?: string
    auth?: string
  }
}

/** The signal-bearing columns of a push_subscription row (id/createdAt added by the server). */
export interface PushSubscriptionRowInput {
  householdId: string
  endpoint: string
  p256dh: string
  auth: string
}

/** The notification body the service worker renders + the URL it opens on tap. */
export interface PushPayload {
  title: string
  body: string
  /** App-relative URL to focus/open when the notification is tapped. */
  url: string
}

/**
 * Map a serialised browser subscription + the owning household to the row the
 * server should upsert, or `null` when the subscription is malformed (missing
 * endpoint or keys). Returning null rather than throwing lets the server fn
 * reject a bad client payload with a clean message.
 */
export function subscriptionToRow(
  householdId: string,
  sub: PushSubscriptionJson | null | undefined,
): PushSubscriptionRowInput | null {
  if (!householdId) return null
  const endpoint = sub?.endpoint?.trim()
  const p256dh = sub?.keys?.p256dh?.trim()
  const auth = sub?.keys?.auth?.trim()
  if (!endpoint || !p256dh || !auth) return null
  return { householdId, endpoint, p256dh, auth }
}

/** The week URL a rate-meal notification deep-links to (optionally a specific plan). */
export function weekUrl(planId?: string | null): string {
  return planId ? `/week?plan=${encodeURIComponent(planId)}` : '/week'
}

/**
 * Build the "rate the meal" notification payload. The meal name is woven into the
 * body ("How was Thai green curry? Tap to rate."); a missing/blank name degrades
 * to a generic "your dinner" so the prompt still reads naturally.
 */
export function buildRateMealPayload(input: {
  mealName?: string | null
  planId?: string | null
}): PushPayload {
  const meal = input.mealName?.trim() || 'your dinner'
  return {
    title: 'Souso',
    body: `How was ${meal}? Tap to rate.`,
    url: weekUrl(input.planId),
  }
}
