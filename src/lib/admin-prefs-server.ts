import { createServerFn } from '@tanstack/react-start'

/**
 * Server fns for the signed-in admin's own waitlist-notification toggle. The
 * pure rules live in admin-prefs.ts; the admin set is resolved from the
 * ADMIN_EMAILS secret (admin-emails.ts). All DB / env access is via dynamic
 * import() so nothing server-only leaks into the client bundle.
 */

/** The current session user's email IF they are an admin, else null. */
async function currentAdminEmail(): Promise<string | null> {
  const { getSessionUser } = await import('./server-auth')
  const u = await getSessionUser()
  if (!u) return null
  const { resolveAdminEmails } = await import('./admin-emails')
  const admins = await resolveAdminEmails()
  const email = u.email.trim().toLowerCase()
  return admins.includes(email) ? email : null
}

/**
 * Whether the signed-in admin currently receives waitlist-signup emails.
 * Default-on: an admin with no stored row gets `true`.
 */
export const getMyWaitlistNotify = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const email = await currentAdminEmail()
    if (!email) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { adminNotificationPref } = await import('../db/admin-prefs-schema')
    const { notifyEnabled } = await import('./admin-prefs')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const row = (
      await db
        .select({ waitlistNotify: adminNotificationPref.waitlistNotify })
        .from(adminNotificationPref)
        .where(eq(adminNotificationPref.email, email))
        .limit(1)
    )[0]
    return notifyEnabled(row)
  },
)

/**
 * Set the signed-in admin's waitlist-notification preference. Upsert keyed on
 * the admin email, so toggling is idempotent.
 */
export const setMyWaitlistNotify = createServerFn({ method: 'POST' })
  .inputValidator((d: { enabled: boolean }) => d)
  .handler(async ({ data }): Promise<{ enabled: boolean }> => {
    const email = await currentAdminEmail()
    if (!email) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { adminNotificationPref } = await import('../db/admin-prefs-schema')
    const db = await getDb()
    const now = new Date()
    await db
      .insert(adminNotificationPref)
      .values({ email, waitlistNotify: data.enabled, updatedAt: now })
      .onConflictDoUpdate({
        target: adminNotificationPref.email,
        set: { waitlistNotify: data.enabled, updatedAt: now },
      })
    return { enabled: data.enabled }
  })
