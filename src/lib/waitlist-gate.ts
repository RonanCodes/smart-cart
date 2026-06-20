import { normalizeWaitlistEmail, upsertWaitlistEmail } from './waitlist-server'
import type { WaitlistDb } from './waitlist-server'

/**
 * Best-effort: add an UNAPPROVED sign-in email to the waitlist so the
 * "You're on the waitlist" message the sign-in gate shows is actually TRUE and
 * an admin sees them at /admin/waitlist. Called from the sign-in gates
 * (auth.ts sendVerificationOTP + demo-auth.ts requestDemoCode) BEFORE they
 * throw NOT_APPROVED_MESSAGE.
 *
 * This lives in its own SERVER-ONLY module (not waitlist-server.ts, which is
 * pulled into the client bundle via joinWaitlist) so the dynamic
 * `import('../db/client')` , and the `cloudflare:workers` binding it carries ,
 * never leaks into the client build. Only the two server-side gates import it.
 *
 * Non-fatal by contract: a DB or normalisation failure must NEVER change the
 * gate behaviour, so every error is swallowed and the gate still throws
 * NOT_APPROVED afterwards regardless of what this returns.
 *
 * Idempotent: reuses the same trim+lowercase normalisation and the
 * onConflictDoNothing upsert as the public join flow, so a second sign-in
 * attempt by the same email is a no-op rather than a duplicate row. Returns
 * `inserted: true` only when a genuinely new row was written.
 */
export async function addUnapprovedEmailToWaitlist(
  rawEmail: string,
): Promise<{ ok: boolean; inserted: boolean }> {
  try {
    const email = normalizeWaitlistEmail(rawEmail)
    const { getDb } = await import('../db/client')
    const db = (await getDb()) as unknown as WaitlistDb
    const result = await upsertWaitlistEmail(db, email)

    // On a genuinely new row, also notify admins , the same best-effort path the
    // public join flow uses. Without this, signups arriving via a gated login
    // attempt (most of them) emailed no one. notifyAdminsOfSignup swallows its
    // own errors, so this cannot change the gate's behaviour.
    if (result.inserted) {
      const { notifyAdminsOfSignup } = await import('./waitlist-notify')
      await notifyAdminsOfSignup(email)
    }

    return result
  } catch {
    // swallow: the sign-in gate must still throw NOT_APPROVED unchanged.
    return { ok: false, inserted: false }
  }
}
