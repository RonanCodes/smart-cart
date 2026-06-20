/**
 * Pure approval rules, with NO env / Cloudflare imports so they can be unit
 * tested under vitest (which can't resolve `cloudflare:workers`). The env-bound
 * entry point `isApproved` lives in access.ts and builds on these.
 */

/** The admin email is always approved, even if APPROVED_EMAILS is unset. */
export const ADMIN_EMAIL = 'tech@discopenguin.com'

/** Message surfaced to a non-approved person trying to sign in. */
export const NOT_APPROVED_MESSAGE =
  "You're on the waitlist. We'll email you when your spot opens."

/** Normalise an email for comparison: trim + lowercase. */
function normalize(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Parse the comma-separated APPROVED_EMAILS env var into a normalised set.
 * Empty / whitespace entries are dropped.
 */
export function parseApprovedList(raw: string | undefined | null): Set<string> {
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((e) => normalize(e))
      .filter(Boolean),
  )
}

/**
 * Pure approval check against an explicit allow-list. The admin email is always
 * approved. Used by `isApproved` (which sources the list from env) and directly
 * by the unit test.
 */
export function isApprovedIn(email: string, approved: Set<string>): boolean {
  const e = normalize(email)
  if (!e) return false
  if (e === ADMIN_EMAIL) return true
  return approved.has(e)
}
