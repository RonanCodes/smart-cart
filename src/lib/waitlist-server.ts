import { createServerFn } from '@tanstack/react-start'
import { waitlist } from '../db/waitlist-schema'
import type { getDb } from '../db/client'

/** Normalise + validate a submitted email. Throws on an obviously bad value. */
export function normalizeWaitlistEmail(raw: string): string {
  const email = raw.trim().toLowerCase()
  // Minimal shape check; the landing input already requires type=email.
  if (!email || !email.includes('@')) {
    throw new Error('Please enter a valid email.')
  }
  return email
}

/**
 * The drizzle insert chain we need from a db handle. Kept as a structural type
 * so the unit test can pass a mock without dragging in a real D1 binding.
 *
 * `.returning()` lets us tell a genuine insert apart from a conflict no-op:
 * onConflictDoNothing returns the inserted rows, so an empty array means the
 * email was already on the list.
 */
type WaitlistDb = {
  insert: (table: typeof waitlist) => {
    values: (row: { id: string; email: string }) => {
      onConflictDoNothing: (args: { target: typeof waitlist.email }) => {
        returning: () => Promise<Array<{ id: string }>>
      }
    }
  }
}

/**
 * Upsert one email onto the waitlist. Idempotent via onConflictDoNothing on the
 * unique email, so a repeat submit is a no-op that keeps the original createdAt.
 * Extracted from the server fn so it can be unit-tested with a mock db.
 *
 * Returns `inserted: true` only when a genuinely new row was written (the
 * `.returning()` rows are non-empty); a duplicate submit returns `inserted: false`.
 */
export async function upsertWaitlistEmail(
  db: WaitlistDb,
  email: string,
): Promise<{ ok: boolean; inserted: boolean }> {
  const rows = await db
    .insert(waitlist)
    .values({ id: crypto.randomUUID(), email })
    .onConflictDoNothing({ target: waitlist.email })
    .returning()
  return { ok: true, inserted: rows.length > 0 }
}

/**
 * Join the waitlist. Idempotent: re-submitting an email that is already on the
 * list is a no-op that still returns { ok: true }, so the landing page can show
 * the friendly confirm without leaking whether the email was new.
 */
export const joinWaitlist = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const email = normalizeWaitlistEmail(data.email)
    const { getDb } = await import('../db/client')
    const realDb = await getDb()
    const db = realDb as unknown as WaitlistDb
    const { inserted } = await upsertWaitlistEmail(db, email)

    // Notify admins only on a genuinely new signup. Best-effort: a failed
    // count, prefs read, or send must never break the signup, so swallow any error.
    if (inserted) {
      try {
        await notifyAdminsOfSignup(realDb, email)
      } catch {
        // swallow: signup already succeeded, admin notify is non-fatal
      }
    }

    return { ok: true }
  })

/** The drizzle handle getDb() returns (D1, main schema). */
type DrizzleDb = Awaited<ReturnType<typeof getDb>>

/**
 * Email every admin who has waitlist notifications enabled (default-on) that a
 * new email just joined, with the running total. Each recipient is sent
 * individually so admins never see each other's addresses, and one recipient's
 * send failure must not stop the rest. Caller wraps this so the signup itself is
 * never affected.
 */
async function notifyAdminsOfSignup(
  db: DrizzleDb,
  newEmail: string,
): Promise<void> {
  const { count } = await import('drizzle-orm')
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
}
