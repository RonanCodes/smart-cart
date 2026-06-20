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
 * The focused rate-this-meal URL a notification deep-links to: a full-screen
 * view scoped to one day of one plan (/rate/$planId/$day). Falls back to the bare
 * week when the plan or day is unknown (no plan yet), so the tap always lands
 * somewhere sensible.
 */
export function rateMealUrl(
  planId?: string | null,
  day?: string | null,
): string {
  if (!planId || !day) return weekUrl(planId)
  return `/rate/${encodeURIComponent(planId)}/${encodeURIComponent(day)}`
}

/**
 * Build the "rate the meal" notification payload, deep-linked to the FOCUSED
 * rate-this-meal view for the specific plan + day (not the whole week).
 *
 * Notification copy (#214): iOS already renders the app name "Souso" as the bold
 * header, so a title of "Souso" reads as a duplicate. The title is a hook
 * ("How was dinner?") and the meal name is woven into the body ("How was Thai
 * green curry? Tap to rate."). A missing/blank meal name degrades to a generic
 * "your dinner" so the prompt still reads naturally.
 */
export function buildRateMealPayload(input: {
  mealName?: string | null
  planId?: string | null
  day?: string | null
}): PushPayload {
  const meal = input.mealName?.trim() || 'your dinner'
  return {
    title: 'How was dinner?',
    body: `How was ${meal}? Tap to rate.`,
    url: rateMealUrl(input.planId, input.day),
  }
}
