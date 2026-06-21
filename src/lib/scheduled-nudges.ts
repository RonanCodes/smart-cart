/**
 * Server-only orchestration for the two scheduled pushes (Part C). NEVER
 * statically imported by client code — the Worker's `scheduled()` handler reaches
 * it via `await import('./scheduled-nudges')`, so its DB / Worker / WebCrypto deps
 * never leak into the client bundle (the planner-core / push-server pattern).
 *
 * `runScheduledNudges` is called from a 15-minute cron. Using Europe/Amsterdam
 * local time it fires:
 *   1. Rate-meal push (~20:00 daily): for each household with a push
 *      subscription whose CURRENT week's plan has a non-skipped dinner TODAY,
 *      send "How was dinner? Tap to rate." deep-linked to the rate view.
 *   2. Weekly-plan reminder: for each household with the reminder enabled, when
 *      the Amsterdam day-of-week + time match its preference, send "Time to plan
 *      next week" deep-linked to the next-week view (/week?week=1).
 *
 * Both are deduped via the nudge_log table (a unique key per household + kind +
 * scope) so the 15-minute tick can't double-send within the same bucket.
 */

import { log } from './log'
import { buildRateMealPayload } from './push'
import {
  amsterdamParts,
  isRateMealBucket,
  isPlanReminderBucket,
} from './amsterdam-time'
import { todayHasCookedDinner } from './scheduled-nudges-core'
import { weekStartForOffset, mondayOf } from './week-offset'

/** Outcome summary, returned for logging/observability (and tests, if wired). */
export interface ScheduledNudgesResult {
  rateMealSent: number
  planReminderSent: number
}

/**
 * Run the scheduled nudges for the instant `now` (defaults to current time).
 * Best-effort: any send failure for one household is swallowed so it can't abort
 * the batch. Never throws into the cron path.
 */
export async function runScheduledNudges(
  now: Date = new Date(),
): Promise<ScheduledNudgesResult> {
  const result: ScheduledNudgesResult = {
    rateMealSent: 0,
    planReminderSent: 0,
  }
  try {
    const { readEnv } = await import('./env')
    const [publicKey, privateKey, subject] = await Promise.all([
      readEnv('VAPID_PUBLIC_KEY'),
      readEnv('VAPID_PRIVATE_KEY'),
      readEnv('VAPID_SUBJECT'),
    ])
    if (!publicKey || !privateKey || !subject) {
      log.warn('nudges.vapid_unconfigured')
      return result
    }
    const vapid = { subject, publicKey, privateKey }

    const rateMeal = isRateMealBucket(now)
    const parts = amsterdamParts(now)

    const { getDb } = await import('../db/client')
    const { mealPlan } = await import('../db/schema')
    const { pushSubscription } = await import('../db/push-subscription-schema')
    const { householdNotifyPref, nudgeLog } =
      await import('../db/notify-prefs-schema')
    const { eq, and, desc, inArray } = await import('drizzle-orm')
    const { sendOne } = await import('./push-send')
    const db = await getDb()

    // The set of households that even can receive a push (have a subscription),
    // with their subscriptions grouped. One query, then group in-process.
    const subs = await db
      .select({
        endpoint: pushSubscription.endpoint,
        p256dh: pushSubscription.p256dh,
        auth: pushSubscription.auth,
        householdId: pushSubscription.householdId,
      })
      .from(pushSubscription)
    if (subs.length === 0) return result

    const subsByHousehold = new Map<string, typeof subs>()
    for (const s of subs) {
      const list = subsByHousehold.get(s.householdId) ?? []
      list.push(s)
      subsByHousehold.set(s.householdId, list)
    }
    const householdIds = [...subsByHousehold.keys()]

    // Has a (household, kind, sentKey) push already gone out? One row in nudge_log
    // means yes. Insert is the claim; the unique index makes it idempotent.
    async function alreadySent(
      householdId: string,
      kind: string,
      sentKey: string,
    ): Promise<boolean> {
      const row = (
        await db
          .select({ id: nudgeLog.id })
          .from(nudgeLog)
          .where(
            and(
              eq(nudgeLog.householdId, householdId),
              eq(nudgeLog.kind, kind),
              eq(nudgeLog.sentKey, sentKey),
            ),
          )
          .limit(1)
      )[0]
      return Boolean(row)
    }
    async function markSent(
      householdId: string,
      kind: string,
      sentKey: string,
    ): Promise<void> {
      try {
        await db.insert(nudgeLog).values({
          id: crypto.randomUUID(),
          householdId,
          kind,
          sentKey,
          createdAt: new Date(),
        })
      } catch {
        // A concurrent tick may have claimed it; the unique index throws. Safe.
      }
    }

    // Send `payload` to every subscription of a household, pruning expired ones.
    async function sendToHousehold(
      householdId: string,
      payload: ReturnType<typeof buildRateMealPayload>,
    ): Promise<number> {
      const list = subsByHousehold.get(householdId) ?? []
      let sent = 0
      const gone: Array<string> = []
      for (const sub of list) {
        try {
          const r = await sendOne(sub, payload, vapid)
          if (r.status === 'sent') sent += 1
          else if (r.status === 'gone') gone.push(sub.endpoint)
        } catch (err) {
          log.error('nudges.send_failed', err, { householdId })
        }
      }
      if (gone.length > 0) {
        await db
          .delete(pushSubscription)
          .where(inArray(pushSubscription.endpoint, gone))
      }
      return sent
    }

    // --- 1. Rate-meal push (~20:00 Amsterdam) ---
    if (rateMeal) {
      const currentWeekStart = mondayOf(now)
      for (const hid of householdIds) {
        try {
          if (await alreadySent(hid, 'rate_meal', parts.date)) continue
          // The current week's newest plan for this household.
          const plan = (
            await db
              .select({ id: mealPlan.id, plan: mealPlan.plan })
              .from(mealPlan)
              .where(
                and(
                  eq(mealPlan.householdId, hid),
                  eq(mealPlan.weekStart, currentWeekStart),
                ),
              )
              .orderBy(desc(mealPlan.createdAt))
              .limit(1)
          )[0]
          if (!plan) continue
          if (!todayHasCookedDinner(plan.plan.days, parts.dow)) continue

          const { planDayForDow } = await import('./scheduled-nudges-core')
          const today = planDayForDow(plan.plan.days, parts.dow)
          const payload = buildRateMealPayload({
            mealName: today?.meal,
            planId: plan.id,
            day: today?.day,
          })
          const sent = await sendToHousehold(hid, payload)
          if (sent > 0) {
            result.rateMealSent += sent
            await markSent(hid, 'rate_meal', parts.date)
          }
        } catch (err) {
          log.error('nudges.rate_meal_failed', err, { householdId: hid })
        }
      }
    }

    // --- 2. Weekly-plan reminder ---
    const prefs = await db
      .select({
        householdId: householdNotifyPref.householdId,
        enabled: householdNotifyPref.planReminderEnabled,
        dow: householdNotifyPref.planReminderDow,
        time: householdNotifyPref.planReminderTime,
      })
      .from(householdNotifyPref)
      .where(eq(householdNotifyPref.planReminderEnabled, true))

    const nextMonday = weekStartForOffset(1, now)
    for (const pref of prefs) {
      // Only households that can actually receive a push.
      if (!subsByHousehold.has(pref.householdId)) continue
      try {
        if (!isPlanReminderBucket(now, pref.dow, pref.time)) continue
        // Dedupe per household + the next week being planned (once per week).
        if (await alreadySent(pref.householdId, 'plan_reminder', nextMonday)) {
          continue
        }
        const payload = {
          title: 'Time to plan next week 🍽️',
          body: 'Tap to set up next week’s dinners.',
          url: '/week?week=1',
        }
        const sent = await sendToHousehold(pref.householdId, payload)
        if (sent > 0) {
          result.planReminderSent += sent
          await markSent(pref.householdId, 'plan_reminder', nextMonday)
        }
      } catch (err) {
        log.error('nudges.plan_reminder_failed', err, {
          householdId: pref.householdId,
        })
      }
    }

    log.info('nudges.run_complete', {
      rateMealSent: result.rateMealSent,
      planReminderSent: result.planReminderSent,
    })
    return result
  } catch (err) {
    // Observability must never crash the cron path.
    log.error('nudges.run_failed', err)
    return result
  }
}
