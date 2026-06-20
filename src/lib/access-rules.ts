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

/** Re-export the normaliser so callers (server fns) share one definition. */
export function normalizeEmail(email: string): string {
  return normalize(email)
}

/**
 * A DB-backed access grant role. 'admin' implies 'user' (admin can both log in
 * and see the console); 'user' is login access only. The always-included
 * ADMIN_EMAIL and the env lists sit OUTSIDE this type, layered on in access.ts /
 * admin-server.ts.
 */
export type GrantRole = 'user' | 'admin'

/**
 * Build a normalised email -> role map from raw access_grant rows. Later rows
 * win on a duplicate email (callers upsert, so duplicates are not expected, but
 * the map is order-stable for tests). Empty / whitespace emails are dropped.
 */
export function grantMapFrom(
  rows: Array<{ email: string; role: GrantRole }>,
): Map<string, GrantRole> {
  const m = new Map<string, GrantRole>()
  for (const r of rows) {
    const e = normalize(r.email)
    if (e) m.set(e, r.role)
  }
  return m
}

/**
 * Pure "is this email approved to log in" against BOTH the env allow-list and a
 * DB grant map. Approved if: the admin email, OR in the env approved set, OR has
 * any grant row (role 'user' OR 'admin' — admin implies approved). The single
 * rule the env-bound `isApproved` builds on.
 */
export function isApprovedWith(
  email: string,
  approved: Set<string>,
  grants: Map<string, GrantRole>,
): boolean {
  const e = normalize(email)
  if (!e) return false
  if (isApprovedIn(e, approved)) return true
  return grants.has(e)
}

/**
 * Pure "is this email an admin" against BOTH the env admin list and a DB grant
 * map. Admin if: in the env admin set (the ADMIN_EMAIL is added to that set by
 * the caller, matching admin-emails.ts), OR has a grant row with role 'admin'.
 */
export function isAdminWith(
  email: string,
  envAdmins: Set<string>,
  grants: Map<string, GrantRole>,
): boolean {
  const e = normalize(email)
  if (!e) return false
  if (envAdmins.has(e)) return true
  return grants.get(e) === 'admin'
}

/**
 * The grant state to surface for ONE email in the admin UI: 'admin' if an admin
 * grant exists, else 'user' if a user grant exists, else 'none'. Pure so the
 * panel's button labels can be tested without a DB.
 */
export function grantStateFor(
  email: string,
  grants: Map<string, GrantRole>,
): GrantRole | 'none' {
  const e = normalize(email)
  if (!e) return 'none'
  return grants.get(e) ?? 'none'
}
