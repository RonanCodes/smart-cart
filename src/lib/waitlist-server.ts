import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { waitlist } from '../db/waitlist-schema'

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
 * The drizzle chain we need from a db handle. Kept as a structural type so the
 * unit test can pass a mock without dragging in a real D1 binding.
 *
 * We SELECT-before-insert to decide new-vs-existing: on Cloudflare D1,
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING` frequently returns NO rows even
 * on a genuine insert, so `.returning()` is unreliable for the new flag. A
 * SELECT on the unique email is deterministic. The insert still uses
 * onConflictDoNothing so it stays idempotent under a race.
 */
export type WaitlistDb = {
  select: (cols: { id: typeof waitlist.id }) => {
    from: (table: typeof waitlist) => {
      where: (cond: ReturnType<typeof eq>) => {
        limit: (n: number) => Promise<Array<{ id: string }>>
      }
    }
  }
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
 * The new-vs-existing decision comes from a SELECT-before-insert, NOT from
 * `.returning()` after onConflictDoNothing: that RETURNING is unreliable on D1
 * (often empty on a real insert), which is why admin notifications never fired.
 * We look the email up first; absent => new => insert => `inserted: true`.
 */
export async function upsertWaitlistEmail(
  db: WaitlistDb,
  email: string,
): Promise<{ ok: boolean; inserted: boolean }> {
  const existing = await db
    .select({ id: waitlist.id })
    .from(waitlist)
    .where(eq(waitlist.email, email))
    .limit(1)
  const isNew = existing.length === 0

  // Always insert (onConflictDoNothing keeps it a safe no-op if a concurrent
  // request inserted the same email between our SELECT and this write).
  await db
    .insert(waitlist)
    .values({ id: crypto.randomUUID(), email })
    .onConflictDoNothing({ target: waitlist.email })
    .returning()

  return { ok: true, inserted: isNew }
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
    // count, prefs read, or send must never break the signup, so the notify
    // helper (and its server-only db/email imports) lives in waitlist-notify.ts
    // and swallows its own errors. Importing it dynamically here keeps
    // cloudflare:workers out of the client bundle (this module is client-imported
    // by the landing via joinWaitlist).
    if (inserted) {
      const { notifyAdminsOfSignup } = await import('./waitlist-notify')
      await notifyAdminsOfSignup(email)
    }

    return { ok: true }
  })
