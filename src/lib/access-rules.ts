/**
 * Pure approval rules, with NO env / Cloudflare imports so they can be unit
 * tested under vitest (which can't resolve `cloudflare:workers`). The env-bound
 * entry point `isApproved` lives in access.ts and builds on these.
 */

/** The admin email is always approved, even if APPROVED_EMAILS is unset. This is
 * also the always-included config admin + the default signup/feedback notify
 * recipient, so keep it to the ONE address that should get those emails. */
export const ADMIN_EMAIL = 'ronan@bluebramble.net'

/**
 * The ONE email that is ALWAYS a super-admin, even with the SUPER_ADMIN_EMAILS
 * secret unset/empty. Mirrors ADMIN_EMAIL: it is folded into the super-admin set
 * by `buildSuperAdminSet` so mission-critical actions (grant admin, broadcast
 * email, the launch toggle) can never be locked out, and so that with no secret
 * configured bluebramble is the only super-admin and nobody else is. Keep it the
 * one address that should hold that power by default.
 */
export const SUPER_ADMIN_EMAIL = 'ronan@bluebramble.net'

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

/**
 * Pure "is this email a super-admin" check against an explicit super-admin set.
 * Super-admins are the tier above admin: they can revoke other admins. The set
 * is sourced from the SUPER_ADMIN_EMAILS env var by the env-bound `isSuperAdmin`
 * in admin-server.ts; this pure form is unit-testable with a fixed set.
 *
 * A super-admin is ALWAYS an admin too, but that implication is applied where
 * the env admin set is built (admin-server.ts folds the super-admin set into the
 * admin set), not here, so this stays a single-responsibility membership test.
 */
export function isSuperAdminWith(
  email: string,
  superAdmins: Set<string>,
): boolean {
  const e = normalize(email)
  if (!e) return false
  return superAdmins.has(e)
}

/**
 * Build the canonical super-admin set: the always-on SUPER_ADMIN_EMAIL constant
 * UNIONED with the comma-separated SUPER_ADMIN_EMAILS secret (normalised). With
 * the secret empty/unset the set is exactly { SUPER_ADMIN_EMAIL }, so bluebramble
 * is a super-admin and nobody else is. The env-bound `adminViewer` in
 * admin-server.ts sources `raw` from the secret and feeds the result to
 * `isSuperAdminWith`; this pure form keeps the constant-∪-secret rule
 * unit-testable in one place.
 */
export function buildSuperAdminSet(
  raw: string | undefined | null,
): Set<string> {
  const set = parseApprovedList(raw)
  set.add(normalize(SUPER_ADMIN_EMAIL))
  return set
}

/**
 * Pure eligibility check for revoking an admin grant. A super-admin may revoke
 * admin from `target` ONLY when EVERY guard rail passes:
 *
 *  1. The actor is a super-admin (the caller already gates the server fn on
 *     this, but the rule is encoded here so it is unit-tested in one place).
 *  2. The target is a DB-granted admin (access_grant role 'admin'). Env-config
 *     admins (ADMIN_EMAILS / SUPER_ADMIN_EMAILS) and the default owner are
 *     config, not runtime grants, so they are NOT revocable here.
 *  3. The target is NOT the default owner (ADMIN_EMAIL), which can never be
 *     locked out.
 *  4. The target is NOT in the env admin set (covers ADMIN_EMAILS + the folded
 *     super-admin set) — same "config, not a grant" reason.
 *  5. A super-admin can NOT revoke themselves.
 *
 * Pure (no env / DB), so the UI's "show the Remove-admin action?" decision and
 * the server fn's guard share one tested rule. Pass the SAME normalised actor
 * and target the server resolves.
 */
export function canRevokeAdmin(args: {
  actorEmail: string
  targetEmail: string
  /** The target's current DB grant role, if any (from grantStateFor / the map). */
  targetGrant: GrantRole | 'none'
  /** Whether the actor is a super-admin. */
  actorIsSuperAdmin: boolean
  /** Env admin set (ADMIN_EMAILS + the folded super-admin set), normalised. */
  envAdmins: Set<string>
}): boolean {
  const actor = normalize(args.actorEmail)
  const target = normalize(args.targetEmail)
  if (!actor || !target) return false
  if (!args.actorIsSuperAdmin) return false
  // Only DB-granted admins are revocable.
  if (args.targetGrant !== 'admin') return false
  // The default owner can never be revoked.
  if (target === ADMIN_EMAIL) return false
  // Env-config admins (incl. super-admins) are config, not runtime grants.
  if (args.envAdmins.has(target)) return false
  // A super-admin can not revoke themselves.
  if (target === actor) return false
  return true
}

/**
 * A real `user`-table row, with everything the people-merge needs. `householdId`
 * is null when the user signed in but never finished onboarding (no household),
 * so it doubles as the onboarded flag.
 */
export interface PersonUserRow<TBadge = unknown> {
  userId: string
  email: string
  householdId: string | null
  swipes: number
  badges: Array<TBadge>
}

/**
 * One person in the merged admin Users view. A person can exist with NO user row
 * (granted/approved/admin-by-env but never signed in) — then userId/householdId
 * are null, swipes is 0, badges is empty, and onboarded is false.
 */
export interface MergedPerson<TBadge = unknown> {
  email: string
  userId: string | null
  householdId: string | null
  swipes: number
  badges: Array<TBadge>
  /** True iff this email is an admin (env admin set OR access_grant role='admin'). */
  isAdmin: boolean
  /** Login-access state: 'admin' grant, else 'user' (env-approved OR user grant), else 'none'. */
  access: 'admin' | 'user' | 'none'
  /** Has a real user row AND a household (finished onboarding). */
  onboarded: boolean
  /**
   * True iff this row is an admin held purely by env config (ADMIN_EMAILS /
   * SUPER_ADMIN_EMAILS / the default owner) rather than a DB grant. The UI shows
   * a 'config admin' tag and no revoke control for these.
   */
  configAdmin: boolean
  /**
   * True iff the VIEWING super-admin may revoke admin from this row (it is a
   * DB-granted admin, not config, not the owner, not the viewer themselves).
   * Always false when the viewer is not a super-admin. Drives the
   * 'Remove admin' action.
   */
  revocable: boolean
}

/**
 * Pure merge of every "person" the admin should see, de-duped by normalised
 * email. Sources: the real `user` table rows, the env admin set (already
 * including the default owner), the env approved set, and the DB access-grant
 * map. People present only in the env/grant sets (never signed in) appear with
 * null ids, 0 swipes, no badges, onboarded=false.
 *
 * Access is the strongest claim found: an admin (env-admin OR admin grant) is
 * 'admin'; otherwise env-approved OR a user grant is 'user'; otherwise (a bare
 * user row with no grant/env entry) 'none'. `onboarded` requires both a user row
 * and a household. No env / DB imports so it is unit-testable.
 *
 * Result is sorted: admins first, then onboarded users, then the rest, each
 * group alphabetised by email, so the operator reads top-down.
 */
export function mergePeople<TBadge = unknown>(args: {
  userRows: Array<PersonUserRow<TBadge>>
  envAdmins: Set<string>
  envApproved: Set<string>
  grants: Map<string, GrantRole>
  /**
   * The signed-in viewer's normalised email. When omitted (or `viewerIsSuperAdmin`
   * is false) every `revocable` is false, so non-super-admins never get the
   * action.
   */
  viewerEmail?: string
  /** Whether the viewer is a super-admin. Defaults to false. */
  viewerIsSuperAdmin?: boolean
}): Array<MergedPerson<TBadge>> {
  const { userRows, envAdmins, envApproved, grants } = args
  const viewerEmail = args.viewerEmail ?? ''
  const viewerIsSuperAdmin = args.viewerIsSuperAdmin ?? false

  // Start from the union of every email we know about, normalised.
  const emails = new Set<string>()
  const byEmail = new Map<string, PersonUserRow<TBadge>>()
  for (const r of userRows) {
    const e = normalize(r.email)
    if (!e) continue
    emails.add(e)
    // First user row wins on a duplicate email (the table enforces unique email,
    // so duplicates are not expected; this is just deterministic).
    if (!byEmail.has(e)) byEmail.set(e, r)
  }
  for (const e of envAdmins) if (e) emails.add(e)
  for (const e of envApproved) if (e) emails.add(e)
  for (const e of grants.keys()) if (e) emails.add(e)

  const people: Array<MergedPerson<TBadge>> = [...emails].map((email) => {
    const row = byEmail.get(email)
    const isAdmin = isAdminWith(email, envAdmins, grants)
    const access: 'admin' | 'user' | 'none' = isAdmin
      ? 'admin'
      : isApprovedWith(email, envApproved, grants)
        ? 'user'
        : 'none'
    const targetGrant = grantStateFor(email, grants)
    // An admin held purely by env config (not a DB grant) is a 'config admin'.
    const configAdmin = isAdmin && targetGrant !== 'admin'
    const revocable = canRevokeAdmin({
      actorEmail: viewerEmail,
      targetEmail: email,
      targetGrant,
      actorIsSuperAdmin: viewerIsSuperAdmin,
      envAdmins,
    })
    return {
      email,
      userId: row?.userId ?? null,
      householdId: row?.householdId ?? null,
      swipes: row?.swipes ?? 0,
      badges: row?.badges ?? [],
      isAdmin,
      access,
      onboarded: Boolean(row?.userId && row.householdId),
      configAdmin,
      revocable,
    }
  })

  // Admins first, then onboarded users, then everyone else; alphabetical within.
  const rank = (p: MergedPerson<TBadge>): number =>
    p.isAdmin ? 0 : p.onboarded ? 1 : 2
  return people.sort(
    (a, b) => rank(a) - rank(b) || a.email.localeCompare(b.email),
  )
}
