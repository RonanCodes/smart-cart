import { count } from 'drizzle-orm'
import { waitlist } from '../db/waitlist-schema'

/**
 * SERVER-ONLY: email every admin who has waitlist notifications enabled
 * (default-on) that a new email just joined, with the running total.
 *
 * This lives in its own module , NOT in waitlist-server.ts , because
 * waitlist-server.ts is pulled into the CLIENT bundle (the landing imports
 * joinWaitlist). The dynamic `import('../db/client')` here carries the
 * `cloudflare:workers` binding, so it must never be reachable from the client
 * build. Only server paths (joinWaitlist's handler, the sign-in gate) import
 * this, and they do so dynamically.
 *
 * Best-effort by contract: a failed count, prefs read, or send must NEVER break
 * the signup or the sign-in gate, so every error is swallowed here. Callers can
 * therefore `await notifyAdminsOfSignup(email)` without their own try/catch.
 *
 * Each recipient is sent individually so admins never see each other's
 * addresses, and one recipient's send failure must not stop the rest.
 */
export async function notifyAdminsOfSignup(newEmail: string): Promise<void> {
  try {
    const { getDb } = await import('../db/client')
    const db = await getDb()

    const total = (await db.select({ n: count() }).from(waitlist))[0]?.n ?? 0

    const { adminNotificationPref } = await import('../db/admin-prefs-schema')
    const prefs = await db
      .select({
        email: adminNotificationPref.email,
        waitlistNotify: adminNotificationPref.waitlistNotify,
      })
      .from(adminNotificationPref)

    const { resolveAdminEmails } = await import('./admin-emails')
    const { recipientsForWaitlist } = await import('./admin-prefs')
    const recipients = recipientsForWaitlist(await resolveAdminEmails(), prefs)

    const { sendWaitlistSignupNotice } = await import('./email')
    for (const to of recipients) {
      try {
        await sendWaitlistSignupNotice(newEmail, total, to)
      } catch {
        // one admin's send failing must not block the others
      }
    }
  } catch {
    // swallow: admin notify is non-fatal; the signup / gate already succeeded
  }
}

/**
 * SERVER-ONLY: email every opted-in admin that a REAL account was just created.
 *
 * Wired into Better Auth's `databaseHooks.user.create.after`, so it fires once
 * per genuinely new account, whichever UI flow created it (the anonymous
 * onboarding flow that ends in OTP verify, a plain sign-in of a first-time
 * approved email, etc.). This is the gap that left admins un-notified: the old
 * notifyAdminsOfSignup only fired on the waitlist-join and sign-in-gate paths,
 * which an approved real sign-up never hits.
 *
 * Same default-on admin pref and same best-effort contract as
 * notifyAdminsOfSignup: every error is swallowed so account creation can never
 * be broken by a count, prefs read, or send. The total is the real account
 * count from the `user` table, not the waitlist.
 */
export async function notifyAdminsOfNewUser(newEmail: string): Promise<void> {
  try {
    const { getDb } = await import('../db/client')
    const db = await getDb()

    const { user } = await import('../db/auth-schema')
    const total = (await db.select({ n: count() }).from(user))[0]?.n ?? 0

    const { adminNotificationPref } = await import('../db/admin-prefs-schema')
    const prefs = await db
      .select({
        email: adminNotificationPref.email,
        waitlistNotify: adminNotificationPref.waitlistNotify,
      })
      .from(adminNotificationPref)

    const { resolveAdminEmails } = await import('./admin-emails')
    const { recipientsForWaitlist } = await import('./admin-prefs')
    const recipients = recipientsForWaitlist(await resolveAdminEmails(), prefs)

    const { sendNewUserNotice } = await import('./email')
    for (const to of recipients) {
      try {
        await sendNewUserNotice(newEmail, total, to)
      } catch {
        // one admin's send failing must not block the others
      }
    }
  } catch {
    // swallow: admin notify is non-fatal; the account was already created
  }
}
