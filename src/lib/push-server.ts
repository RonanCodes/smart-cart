import { createServerFn } from '@tanstack/react-start'
import { subscriptionToRow, buildRateMealPayload } from './push'
import type { PushSubscriptionJson } from './push'

/**
 * Server fns for PWA Web Push (#149): expose the VAPID public key to the client,
 * store a browser's subscription, and (admin-gated) send a "rate the meal" push.
 *
 * VAPID = Voluntary Application Server Identification. Three secrets drive it:
 *   - VAPID_PUBLIC_KEY  (client-exposed; the browser subscribes against it)
 *   - VAPID_PRIVATE_KEY (server-only; signs the push request)
 *   - VAPID_SUBJECT     (server-only; a mailto: or https: contact for the push service)
 * The human sets these as Worker secrets; until then every path degrades to a
 * clear "push not configured" message rather than a 500.
 *
 * Server-only modules (DB client, schema, the WebCrypto send) are dynamically
 * imported inside the handlers so none of it leaks into the client bundle (the
 * admin-server / week-server pattern).
 */

/** What the client needs before it can subscribe. */
export interface PushConfig {
  /** Set when VAPID_PUBLIC_KEY is configured; the client subscribes against it. */
  publicKey: string | null
  /** True when all three VAPID secrets are present (the admin send will work). */
  configured: boolean
}

/**
 * Expose the VAPID public key (and whether sending is fully configured) to the
 * client. The public key is, by design, public, so returning it is safe; the
 * private key never leaves the server. When unset, `publicKey` is null and the
 * client skips the subscribe flow with a clear message.
 */
export const getPushConfig = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PushConfig> => {
    const { readEnv } = await import('./env')
    const [pub, priv, subject] = await Promise.all([
      readEnv('VAPID_PUBLIC_KEY'),
      readEnv('VAPID_PRIVATE_KEY'),
      readEnv('VAPID_SUBJECT'),
    ])
    return {
      publicKey: pub ?? null,
      configured: Boolean(pub && priv && subject),
    }
  },
)

/**
 * Store (upsert) the signed-in household's browser push subscription. Keyed on
 * the unique `endpoint`, so re-subscribing the same browser updates the keys
 * rather than stacking duplicate rows. Rejects a malformed subscription and an
 * un-onboarded user (no household to attach to) with a clear message.
 */
export const subscribePush = createServerFn({ method: 'POST' })
  .inputValidator((d: { subscription: PushSubscriptionJson }) => d)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { pushSubscription } = await import('../db/push-subscription-schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const hh = (
      await db
        .select({ id: household.id })
        .from(household)
        .where(eq(household.ownerId, user.id))
        .limit(1)
    )[0]
    if (!hh) throw new Error('No household, onboard first')

    const row = subscriptionToRow(hh.id, data.subscription)
    if (!row) throw new Error('Invalid push subscription')

    await db
      .insert(pushSubscription)
      .values({
        id: crypto.randomUUID(),
        householdId: row.householdId,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: pushSubscription.endpoint,
        set: {
          householdId: row.householdId,
          p256dh: row.p256dh,
          auth: row.auth,
          createdAt: new Date(),
        },
      })
    return { ok: true }
  })

/** Input for the admin send: one user (by id) or every subscriber. */
export interface SendRateMealPushInput {
  /** Target a single user (their household's subscriptions). Omit to send to all. */
  userId?: string
  /** When true, send to every stored subscription regardless of userId. */
  all?: boolean
}

export interface SendRateMealPushResult {
  /** False when VAPID is not fully configured: nothing was sent. */
  configured: boolean
  /** How many subscriptions were targeted. */
  targeted: number
  /** How many sends succeeded. */
  sent: number
  /** Expired subscriptions pruned (404/410 from the push service). */
  pruned: number
  /** A human message for the admin UI (covers the not-configured + nobody cases). */
  message: string
}

/**
 * Admin-gated: send a "How was <meal>? Tap to rate." push to a user (or all
 * subscribers). Looks up the target household(s)'s most recent confirmed dinner
 * to name the meal + deep-link the notification to that week; falls back to a
 * generic prompt + the bare /week route when there is no plan yet.
 *
 * Degrades cleanly when VAPID is unset (returns configured:false with a clear
 * message, sends nothing) so the admin sees why instead of a 500. Expired
 * subscriptions (404/410) are pruned so dead rows don't accumulate.
 */
export const sendRateMealPush = createServerFn({ method: 'POST' })
  .inputValidator((d: SendRateMealPushInput) => d)
  .handler(async ({ data }): Promise<SendRateMealPushResult> => {
    // Reuse the existing admin gate (a server fn, so it is stripped from the
    // client bundle); a non-admin caller is rejected before any send.
    const { isAdmin } = await import('./admin-server')
    if (!(await isAdmin())) throw new Error('forbidden')

    const { readEnv } = await import('./env')
    const [publicKey, privateKey, subject] = await Promise.all([
      readEnv('VAPID_PUBLIC_KEY'),
      readEnv('VAPID_PRIVATE_KEY'),
      readEnv('VAPID_SUBJECT'),
    ])
    if (!publicKey || !privateKey || !subject) {
      return {
        configured: false,
        targeted: 0,
        sent: 0,
        pruned: 0,
        message:
          'Push not configured. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT as Worker secrets.',
      }
    }

    const { getDb } = await import('../db/client')
    const { pushSubscription } = await import('../db/push-subscription-schema')
    const { household, mealPlan } = await import('../db/schema')
    const { eq, desc, inArray } = await import('drizzle-orm')
    const db = await getDb()

    // Resolve target households. A specific userId narrows to that user's
    // household; otherwise (or with all:true) every household with a subscription.
    let householdIds: Array<string>
    if (data.userId && !data.all) {
      const hh = (
        await db
          .select({ id: household.id })
          .from(household)
          .where(eq(household.ownerId, data.userId))
          .limit(1)
      )[0]
      householdIds = hh ? [hh.id] : []
    } else {
      const all = await db
        .select({ householdId: pushSubscription.householdId })
        .from(pushSubscription)
      householdIds = [...new Set(all.map((r) => r.householdId))]
    }

    if (householdIds.length === 0) {
      return {
        configured: true,
        targeted: 0,
        sent: 0,
        pruned: 0,
        message: data.userId
          ? 'That user has no push subscription yet (they must enable notifications in the app).'
          : 'No push subscriptions stored yet.',
      }
    }

    const subs = await db
      .select({
        endpoint: pushSubscription.endpoint,
        p256dh: pushSubscription.p256dh,
        auth: pushSubscription.auth,
        householdId: pushSubscription.householdId,
      })
      .from(pushSubscription)
      .where(inArray(pushSubscription.householdId, householdIds))

    if (subs.length === 0) {
      return {
        configured: true,
        targeted: 0,
        sent: 0,
        pruned: 0,
        message: 'No push subscriptions stored for the target.',
      }
    }

    // Name the meal + deep-link per household from its latest plan, when present.
    // The deep-link is the FOCUSED rate-this-meal view (#214), so we capture the
    // day label alongside the meal name to build /rate/$planId/$day.
    const planByHousehold = new Map<
      string,
      { planId: string; meal: string | null; day: string | null }
    >()
    for (const hid of householdIds) {
      const plan = (
        await db
          .select({ id: mealPlan.id, plan: mealPlan.plan })
          .from(mealPlan)
          .where(eq(mealPlan.householdId, hid))
          .orderBy(desc(mealPlan.createdAt))
          .limit(1)
      )[0]
      if (plan) {
        const firstHome = plan.plan.days.find((d) => d.type !== 'out')
        planByHousehold.set(hid, {
          planId: plan.id,
          meal: firstHome?.meal ?? null,
          day: firstHome?.day ?? null,
        })
      }
    }

    const { sendOne } = await import('./push-send')
    const vapid = { subject, publicKey, privateKey }

    let sent = 0
    const goneEndpoints: Array<string> = []
    for (const sub of subs) {
      const ctx = planByHousehold.get(sub.householdId)
      const payload = buildRateMealPayload({
        mealName: ctx?.meal,
        planId: ctx?.planId,
        day: ctx?.day,
      })
      const result = await sendOne(sub, payload, vapid)
      if (result.status === 'sent') sent += 1
      else if (result.status === 'gone') goneEndpoints.push(sub.endpoint)
    }

    if (goneEndpoints.length > 0) {
      await db
        .delete(pushSubscription)
        .where(inArray(pushSubscription.endpoint, goneEndpoints))
    }

    return {
      configured: true,
      targeted: subs.length,
      sent,
      pruned: goneEndpoints.length,
      message: `Sent ${sent} of ${subs.length} push notification${subs.length === 1 ? '' : 's'}.`,
    }
  })
