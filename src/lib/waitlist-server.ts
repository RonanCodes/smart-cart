import { createServerFn } from '@tanstack/react-start'
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
    const db = (await getDb()) as unknown as WaitlistDb
    const { inserted } = await upsertWaitlistEmail(db, email)

    // Notify the admin only on a genuinely new signup. Best-effort: a failed
    // count or send must never break the signup, so swallow any error.
    if (inserted) {
      try {
        const { sendWaitlistSignupNotice } = await import('./email')
        const { count } = await import('drizzle-orm')
        const total =
          (
            await (
              db as unknown as {
                select: (s: { n: ReturnType<typeof count> }) => {
                  from: (t: typeof waitlist) => Promise<Array<{ n: number }>>
                }
              }
            )
              .select({ n: count() })
              .from(waitlist)
          )[0]?.n ?? 0
        await sendWaitlistSignupNotice(email, total)
      } catch {
        // swallow: signup already succeeded, admin notify is non-fatal
      }
    }

    return { ok: true }
  })
