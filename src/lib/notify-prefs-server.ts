import { createServerFn } from '@tanstack/react-start'
import { DEFAULT_NOTIFY_PREFS, validateNotifyPrefs } from './notify-prefs'
import type { NotifyPrefs } from './notify-prefs'

/**
 * Server fns for the household's weekly-plan reminder preference (Part B).
 *
 * Household-scoped: the prefs row is keyed by household id, resolved from the
 * signed-in user. A household with no row reads as the default (opt-in, off).
 *
 * Server-only modules (DB client, schema) are dynamically imported inside the
 * handlers so none of it leaks into the client bundle (the week-server /
 * push-server pattern). The pure validation + defaults are imported statically
 * (no DB/Worker deps) so the client form can reuse them too.
 */

/** Resolve the signed-in user's household id, or throw a clear error. */
async function requireHouseholdId(): Promise<string> {
  const { getSessionUser } = await import('./server-auth')
  const user = await getSessionUser()
  if (!user) throw new Error('Not signed in')

  const { getDb } = await import('../db/client')
  const { household } = await import('../db/schema')
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
  return hh.id
}

/**
 * Read the signed-in household's weekly-plan reminder preference. Returns the
 * default (off, Sunday, 17:00) when no row exists yet.
 */
export const getMyNotifyPrefs = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NotifyPrefs> => {
    const householdId = await requireHouseholdId()

    const { getDb } = await import('../db/client')
    const { householdNotifyPref } = await import('../db/notify-prefs-schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const row = (
      await db
        .select({
          enabled: householdNotifyPref.planReminderEnabled,
          dow: householdNotifyPref.planReminderDow,
          time: householdNotifyPref.planReminderTime,
        })
        .from(householdNotifyPref)
        .where(eq(householdNotifyPref.householdId, householdId))
        .limit(1)
    )[0]

    if (!row) return DEFAULT_NOTIFY_PREFS
    return { enabled: row.enabled, dow: row.dow, time: row.time }
  },
)

/**
 * Upsert the signed-in household's weekly-plan reminder preference. Validates dow
 * (0-6) + time ('HH:MM') before writing; a malformed value throws a clear error
 * rather than persisting garbage.
 */
export const setMyNotifyPrefs = createServerFn({ method: 'POST' })
  .inputValidator((d: { enabled: boolean; dow: number; time: string }) =>
    validateNotifyPrefs(d),
  )
  .handler(async ({ data }): Promise<NotifyPrefs> => {
    const householdId = await requireHouseholdId()

    const { getDb } = await import('../db/client')
    const { householdNotifyPref } = await import('../db/notify-prefs-schema')
    const db = await getDb()

    await db
      .insert(householdNotifyPref)
      .values({
        householdId,
        planReminderEnabled: data.enabled,
        planReminderDow: data.dow,
        planReminderTime: data.time,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: householdNotifyPref.householdId,
        set: {
          planReminderEnabled: data.enabled,
          planReminderDow: data.dow,
          planReminderTime: data.time,
          updatedAt: new Date(),
        },
      })

    return { enabled: data.enabled, dow: data.dow, time: data.time }
  })
