import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
// Pure helpers are import-safe (no cloudflare:workers / DB), so shapeWaitlist —
// a synchronous pure fn used directly by the unit test — can use them at module
// scope. The env/DB-bound work still goes through dynamic import() below.
import { canRevokeAdmin, ADMIN_EMAIL } from './access-rules'
// Bundled at build time, NOT read from disk: Cloudflare Workers has no filesystem,
// so a runtime readFileSync threw "[unenv] fs.readFileSync is not implemented" and
// 500'd the whole /admin loader in prod. The baseline is tiny (~1KB), so importing
// it is free and works on the edge.
import benchmarkBaseline from '../../docs/benchmarks/baseline.json'
import { deriveBadges } from './badges'
import type { Badge } from './badges'
import type {
  AdaptiveWeights,
  InferredTaste,
  RecipeLite,
  UserProfile,
} from './recsys/types'
import type { FoldStats } from './recsys/feedback-fold'
import type { UserExplanation } from './recsys/explain-why'
import { executeReset } from './reset-plan'
import type { ResetExecutor, HouseholdScopedTable } from './reset-plan'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
// Type-only imports (erased at build, no client-bundle leak): the reset
// executor needs the household-scoped table types to name its delete targets.
// The runtime tables are still pulled in via dynamic import() in loadResetTables.
import type {
  household as householdTable,
  mealPlan as mealPlanTable,
  recipeSwipe as recipeSwipeTable,
  mealFeedback as mealFeedbackTable,
  householdMemory as householdMemoryTable,
} from '../db/schema'
import type { shoppingListItem as shoppingListItemTable } from '../db/shopping-list-schema'
import type { staple as stapleTable } from '../db/staples-schema'
import type { pushSubscription as pushSubscriptionTable } from '../db/push-subscription-schema'

/**
 * Who can see the admin console. The list is env-driven (comma-separated
 * ADMIN_EMAILS), so admins can be added/removed by setting a Worker secret
 * with no redeploy. The default owner (ADMIN_EMAIL) is always included, so the
 * console can never be locked out, and email matching is trim+lowercase
 * normalised (reusing the pure access-rules helpers).
 */
async function adminUser() {
  const { getSessionUser } = await import('./server-auth')
  const u = await getSessionUser()
  if (!u) return null
  // Local dev open-access: any (dev) session is an admin so /admin opens with no
  // setup. Dead code in the deployed build (import.meta.env.DEV is false there).
  if (import.meta.env.DEV) return u
  const { isAdminWith } = await import('./access-rules')
  // Env admins + the always-included default owner + super-admins (mirrors
  // admin-emails.ts), so the console can never be locked out.
  const { envAdmins } = await loadEnvAdmins()
  // DB-backed admin grants (role='admin') let the console promote admins with no
  // redeploy. A missing grant table degrades to env-only (loadAdminGrantMap
  // returns an empty map) rather than locking everyone out.
  const grants = await loadAdminGrantMap()
  return isAdminWith(u.email, envAdmins, grants) ? u : null
}

/**
 * Resolve the env admin set the gate uses: the comma-separated ADMIN_EMAILS,
 * PLUS the default owner, PLUS the super-admin set (super-admins are always
 * admins). Shared by the admin gate and the revoke logic so "env config admin"
 * means the same thing everywhere. Returns the set and the super-admin sub-set
 * (the caller needs both to classify config-vs-grant + super-admin status).
 */
async function loadEnvAdmins(): Promise<{
  envAdmins: Set<string>
  superAdmins: Set<string>
}> {
  const { readEnv } = await import('./env')
  const { parseApprovedList, buildSuperAdminSet } =
    await import('./access-rules')
  // ADMIN_EMAIL is the module-scope import (import-safe pure constant).
  const envAdmins = parseApprovedList(await readEnv('ADMIN_EMAILS'))
  envAdmins.add(ADMIN_EMAIL)
  // The super-admin set ALWAYS includes the SUPER_ADMIN_EMAIL constant, unioned
  // with the SUPER_ADMIN_EMAILS secret, so with no secret ronanconnolly.dev is
  // the only super-admin and the mission-critical gate can never be locked out.
  const superAdmins = buildSuperAdminSet(await readEnv('SUPER_ADMIN_EMAILS'))
  // Super-admins are always admins too.
  for (const e of superAdmins) envAdmins.add(e)
  return { envAdmins, superAdmins }
}

/**
 * The signed-in viewer as the admin gate sees them, plus whether they are a
 * super-admin. Returns null when there is no admin session. Used by the loaders
 * so they can server-decide the super-admin flag + revoke eligibility instead of
 * trusting the client.
 */
async function adminViewer(): Promise<{
  email: string
  isSuperAdmin: boolean
} | null> {
  const u = await adminUser()
  if (!u) return null
  const { isSuperAdminWith } = await import('./access-rules')
  const { superAdmins } = await loadEnvAdmins()
  return {
    email: u.email,
    isSuperAdmin: isSuperAdminWith(u.email, superAdmins),
  }
}

/**
 * Gate a mission-critical action behind super-admin. Returns the viewer (so the
 * caller can use their email) or throws 'forbidden' when the caller is not a
 * super-admin. The single server-side guard reused by every super-admin-only
 * action (grant admin, the launch toggle, the launch-email broadcast), so a
 * regular admin is blocked server-side, not merely hidden in the UI.
 *
 * NOT exported: an exported plain async fn would be reachable from the client
 * import of this module, dragging its transitive `cloudflare:workers` env import
 * into the browser bundle (only `createServerFn().handler` bodies are stripped).
 * Server fns here call it directly; launch-server gates via its own copy that
 * reuses the exported `isSuperAdmin` server fn.
 */
async function requireSuperAdmin(): Promise<{
  email: string
  isSuperAdmin: boolean
}> {
  const v = await adminViewer()
  if (!v || !v.isSuperAdmin) throw new Error('forbidden')
  return v
}

/** Server fn: is the signed-in user a super-admin? Server-decided, never client. */
export const isSuperAdmin = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => {
    const v = await adminViewer()
    return Boolean(v?.isSuperAdmin)
  },
)

/**
 * Load the DB-backed grant map (normalised email -> role) for the admin gate +
 * the waitlist view. Dynamically imports the DB client + schema so nothing
 * server-only leaks to the client bundle. Returns an empty map if the table is
 * unavailable (e.g. migration 0004 not yet applied).
 */
async function loadAdminGrantMap() {
  const { grantMapFrom } = await import('./access-rules')
  try {
    const { getDb } = await import('../db/client')
    const { accessGrant } = await import('../db/access-grant-schema')
    const db = await getDb()
    const rows = await db
      .select({ email: accessGrant.email, role: accessGrant.role })
      .from(accessGrant)
    return grantMapFrom(rows)
  } catch {
    return grantMapFrom([])
  }
}

export const isAdmin = createServerFn({ method: 'GET' }).handler(
  async (): Promise<boolean> => Boolean(await adminUser()),
)

/** beforeLoad guard for /admin: non-admins are bounced to the home page. */
export async function requireAdminBeforeLoad(): Promise<void> {
  if (!(await isAdmin())) throw redirect({ to: '/' })
}

/**
 * One person in the admin Users view. `userId` / `householdId` are null for a
 * person who is granted / approved / admin-by-env but has never signed in (no
 * `user` row). The panel disables the data-points drill-down for those (no
 * userId to look up). `access` + `isAdmin` drive the Admin badge + access tag.
 */
export interface AdminUserRow {
  userId: string | null
  email: string
  householdId: string | null
  swipes: number
  badges: Array<Badge>
  isAdmin: boolean
  access: 'admin' | 'user' | 'none'
  onboarded: boolean
  /** Admin held purely by env config (no DB grant) — shown with a 'config admin' tag, no revoke. */
  configAdmin: boolean
  /** Viewing super-admin may revoke admin from this DB-granted admin row. */
  revocable: boolean
  /**
   * Account-creation time as epoch ms, or null for an env/grant-only person who
   * never signed in (no `user` row). Drives the signups-over-time chart + the
   * "new this week" total + the newest-first sort. Attached after the merge by
   * joining back on userId (mergePeople stays badge-only by design).
   */
  createdAt: number | null
  /** Optional phone/WhatsApp a beta tester left in onboarding (#407), so the
   * team can reach out for a chat. null when not given. Attached post-merge. */
  phone: string | null
  /** Preferred contact method (#407): 'whatsapp' | 'call' | 'either' | null. */
  contactPref: string | null
}

export const listUsers = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<AdminUserRow>> => {
    const viewer = await adminViewer()
    if (!viewer) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { user, household, recipeSwipe } = await import('../db/schema')
    const { eq, count } = await import('drizzle-orm')
    const { readEnv } = await import('./env')
    const { parseApprovedList, mergePeople } = await import('./access-rules')
    const db = await getDb()
    const rows = await db
      .select({
        userId: user.id,
        email: user.email,
        householdId: household.id,
        profile: household.profile,
        createdAt: user.createdAt,
      })
      .from(user)
      .leftJoin(household, eq(household.ownerId, user.id))
    // Account-creation time per userId (epoch ms), for the analytics view. Built
    // here and re-joined onto the merged rows below, so mergePeople stays a pure
    // badge-only generic (its shared tests don't change). createdAt is a drizzle
    // timestamp (Date); guard nulls and convert to epoch ms.
    const createdAtByUserId = new Map<string, number>()
    // Optional phone left in the onboarding beta step lives on profile.phone
    // (#407); re-join it onto the merged rows the same way as createdAt.
    const phoneByUserId = new Map<string, string>()
    const contactPrefByUserId = new Map<string, string>()
    for (const r of rows) {
      if (r.userId && r.createdAt instanceof Date) {
        createdAtByUserId.set(r.userId, r.createdAt.getTime())
      }
      const prof = r.profile as {
        phone?: unknown
        contactPref?: unknown
      } | null
      const phone = prof?.phone
      if (r.userId && typeof phone === 'string' && phone.trim()) {
        phoneByUserId.set(r.userId, phone)
      }
      const pref = prof?.contactPref
      if (r.userId && typeof pref === 'string' && pref) {
        contactPrefByUserId.set(r.userId, pref)
      }
    }
    const counts = await db
      .select({ hid: recipeSwipe.householdId, n: count() })
      .from(recipeSwipe)
      .groupBy(recipeSwipe.householdId)
    const byHid = new Map(counts.map((c) => [c.hid, c.n]))

    // Resolve the env + DB access sets so people who never signed in still show.
    // Env admins always include the default owner + super-admins (mirrors
    // admin-emails.ts), so the console can never present as locked out.
    const { envAdmins } = await loadEnvAdmins()
    const envApproved = parseApprovedList(await readEnv('APPROVED_EMAILS'))
    const grants = await loadAdminGrantMap()

    const merged = mergePeople<Badge>({
      userRows: rows.map((r) => ({
        userId: r.userId,
        email: r.email,
        householdId: r.householdId,
        swipes: r.householdId ? (byHid.get(r.householdId) ?? 0) : 0,
        badges: r.profile ? deriveBadges(r.profile) : [],
      })),
      envAdmins,
      envApproved,
      grants,
      viewerEmail: viewer.email,
      viewerIsSuperAdmin: viewer.isSuperAdmin,
    })
    // Re-attach createdAt by userId (env/grant-only people with no user row keep
    // null), so AdminUserRow carries the signup time the analytics view needs.
    return merged.map((p) => ({
      ...p,
      createdAt: p.userId ? (createdAtByUserId.get(p.userId) ?? null) : null,
      phone: p.userId ? (phoneByUserId.get(p.userId) ?? null) : null,
      contactPref: p.userId
        ? (contactPrefByUserId.get(p.userId) ?? null)
        : null,
    }))
  },
)

// ---------------------------------------------------------------------------
// Waitlist console: list the marketing-landing signups (newest first) so the
// admin can see who joined and how many. Read-only; the waitlist table lives
// outside the main profile schema (src/db/waitlist-schema.ts).
// ---------------------------------------------------------------------------

/** The access state of a waitlist email: not granted, granted user, or admin. */
export type GrantState = 'none' | 'user' | 'admin'

/** One waitlist signup, shaped for the admin list. */
export interface WaitlistRowView {
  email: string
  /** ISO-8601 signup timestamp. */
  createdAt: string
  /** Current DB-backed grant for this email, so buttons reflect state. */
  grant: GrantState
  /** Admin held purely by env config (no DB grant) — 'config admin' tag, no revoke. */
  configAdmin: boolean
  /** Viewing super-admin may revoke admin from this DB-granted admin row. */
  revocable: boolean
}

export interface WaitlistView {
  count: number
  rows: Array<WaitlistRowView>
  /** True iff the viewer is a super-admin (server-decided). Gates the revoke UI. */
  viewerIsSuperAdmin: boolean
}

/**
 * Shape raw waitlist rows into the admin view: newest first, dates as ISO
 * strings, each tagged with its current grant state + whether the viewing
 * super-admin may revoke it, plus the total count. Pure so it can be unit-tested
 * with a fixture (pass the grant map the rows resolve against; default empty =
 * nobody granted). The optional `viewer` block carries the server-decided
 * super-admin context; omit it and every row is non-revocable.
 */
export function shapeWaitlist(
  rows: Array<{ email: string; createdAt: Date | string | number }>,
  grants: ReadonlyMap<string, 'user' | 'admin'> = new Map(),
  viewer: {
    email: string
    isSuperAdmin: boolean
    envAdmins: ReadonlySet<string>
  } = { email: '', isSuperAdmin: false, envAdmins: new Set() },
): WaitlistView {
  const grantMap = new Map(grants)
  const envAdmins = new Set(viewer.envAdmins)
  const view = rows
    .map((r): WaitlistRowView => {
      const email = r.email
      const norm = email.trim().toLowerCase()
      const grant = grantMap.get(norm) ?? 'none'
      const isEnvAdmin = envAdmins.has(norm) || norm === ADMIN_EMAIL
      // A config admin is an env/owner admin that has no DB admin grant.
      const configAdmin = isEnvAdmin && grant !== 'admin'
      const revocable = canRevokeAdmin({
        actorEmail: viewer.email,
        targetEmail: email,
        targetGrant: grant,
        actorIsSuperAdmin: viewer.isSuperAdmin,
        envAdmins,
      })
      return {
        email,
        createdAt:
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : new Date(r.createdAt).toISOString(),
        grant,
        configAdmin,
        revocable,
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return {
    count: view.length,
    rows: view,
    viewerIsSuperAdmin: viewer.isSuperAdmin,
  }
}

/**
 * Which controls a single waitlist row should show, derived purely from its
 * grant state + config-admin + revocable flags. Centralised here (not inline in
 * the component) so the per-state matrix is unit-testable and the row JSX stays
 * declarative. The four states, in priority order:
 *
 *  - config/owner admin (env config, never a DB grant) -> Admin badge + a
 *    'config admin' tag, NO action buttons. This takes precedence: an env admin
 *    must never be offered Approve / Make admin even if they also sit on the
 *    waitlist with no DB grant.
 *  - DB-granted admin -> Admin badge + (super-admin only) Remove admin.
 *  - approved user (not admin) -> 'Approved' tag + Make admin.
 *  - not approved, not admin -> Approve as user + Make admin.
 */
export interface WaitlistRowActions {
  /** Show the green "Approve as user" grant button. */
  approveAsUser: boolean
  /** Show the "Make admin" promote button. */
  makeAdmin: boolean
  /** Show the static "Approved" user tag (already a plain user, can't re-approve). */
  approvedTag: boolean
  /** Show the "Admin" badge (DB-granted OR config admin). */
  adminBadge: boolean
  /** Show the static "config admin" tag (env/owner admin, not a DB grant). */
  configAdminTag: boolean
  /** Show the destructive "Remove admin" button (super-admin, DB-granted only). */
  removeAdmin: boolean
}

export function waitlistRowActions(row: {
  grant: GrantState
  configAdmin: boolean
  revocable: boolean
}): WaitlistRowActions {
  const none: WaitlistRowActions = {
    approveAsUser: false,
    makeAdmin: false,
    approvedTag: false,
    adminBadge: false,
    configAdminTag: false,
    removeAdmin: false,
  }

  // Config/owner admin wins outright: badge + tag, never approve/make-admin.
  if (row.configAdmin) {
    return { ...none, adminBadge: true, configAdminTag: true }
  }

  // DB-granted admin: badge, and Remove admin only when the viewer may revoke.
  if (row.grant === 'admin') {
    return { ...none, adminBadge: true, removeAdmin: row.revocable }
  }

  // Approved plain user: a tag instead of the approve button, still promotable.
  if (row.grant === 'user') {
    return { ...none, approvedTag: true, makeAdmin: true }
  }

  // Not approved, not admin: both grant actions.
  return { ...none, approveAsUser: true, makeAdmin: true }
}

/**
 * The set of waitlist emails an "Approve all" action should grant. A row is
 * approvable iff its derived actions offer "Approve as user", i.e. it has no DB
 * grant yet and is not a config/owner admin. Already-approved users, admins, and
 * config admins are skipped. Pure (derives purely from each row's flags via the
 * same `waitlistRowActions` matrix the UI uses), so the count the button shows
 * and the emails the server grants stay in lock-step and are unit-testable.
 */
export function pendingApprovableEmails(
  rows: ReadonlyArray<WaitlistRowView>,
): Array<string> {
  return rows
    .filter(
      (r) =>
        waitlistRowActions({
          grant: r.grant,
          configAdmin: r.configAdmin,
          revocable: r.revocable,
        }).approveAsUser,
    )
    .map((r) => r.email)
}

export const listWaitlist = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WaitlistView> => {
    const viewer = await adminViewer()
    if (!viewer) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { waitlist } = await import('../db/waitlist-schema')
    const db = await getDb()
    const rows = await db
      .select({ email: waitlist.email, createdAt: waitlist.createdAt })
      .from(waitlist)
    const grants = await loadAdminGrantMap()
    const { envAdmins } = await loadEnvAdmins()
    return shapeWaitlist(rows, grants, {
      email: viewer.email,
      isSuperAdmin: viewer.isSuperAdmin,
      envAdmins,
    })
  },
)

/**
 * Revoke admin from `email`: super-admin-gated, deletes the access_grant row so
 * the person drops to no DB grant (re-grant via "Make admin" re-creates it). All
 * guard rails (DB-granted-admin only, never the owner, never an env/config admin,
 * never self) are enforced by the pure `canRevokeAdmin` rule. Returns the email
 * and its resulting grant state ('none').
 */
export const revokeAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }): Promise<{ email: string; grant: GrantState }> => {
    const viewer = await adminViewer()
    if (!viewer || !viewer.isSuperAdmin) throw new Error('forbidden')
    const { normalizeEmail, grantStateFor } = await import('./access-rules')
    const email = normalizeEmail(data.email)
    if (!email) throw new Error('email required')
    const grants = await loadAdminGrantMap()
    const { envAdmins } = await loadEnvAdmins()
    // Re-check every guard rail server-side; the UI flag is advisory only.
    if (
      !canRevokeAdmin({
        actorEmail: viewer.email,
        targetEmail: email,
        targetGrant: grantStateFor(email, grants),
        actorIsSuperAdmin: viewer.isSuperAdmin,
        envAdmins,
      })
    ) {
      throw new Error('not revocable')
    }
    const { getDb } = await import('../db/client')
    const { accessGrant } = await import('../db/access-grant-schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    await db.delete(accessGrant).where(eq(accessGrant.email, email))
    return { email, grant: 'none' }
  })

// ---------------------------------------------------------------------------
// Access grants: approve a waitlisted person (role 'user') or promote them to
// admin (role 'admin') from the console, with NO redeploy. Both upsert into the
// access_grant table keyed on the normalised email, so they are idempotent.
// Admin-gated. isApproved (access.ts) + the adminUser gate above read these.
// ---------------------------------------------------------------------------

/**
 * Grant login access to `email` (role 'user'). No-op if the email is ALREADY an
 * admin grant (admin implies user, so we never downgrade an admin to a plain
 * user). Returns the resulting grant state.
 */
export const grantUser = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }): Promise<{ email: string; grant: GrantState }> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { normalizeEmail } = await import('./access-rules')
    const email = normalizeEmail(data.email)
    if (!email) throw new Error('email required')
    const { getDb } = await import('../db/client')
    const { accessGrant } = await import('../db/access-grant-schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    // Don't downgrade an existing admin grant.
    const existing = (
      await db
        .select({ role: accessGrant.role })
        .from(accessGrant)
        .where(eq(accessGrant.email, email))
        .limit(1)
    )[0]
    if (existing?.role === 'admin') return { email, grant: 'admin' }
    // Only email an approval link on a genuinely NEW grant, not on re-approving
    // an already-'user' email (avoids a duplicate "you're in" email on a repeat
    // click). The link itself stays one-time + short-TTL even if it is re-sent.
    const wasNew = existing?.role !== 'user'
    const now = new Date()
    await db
      .insert(accessGrant)
      .values({ email, role: 'user', createdAt: now })
      .onConflictDoUpdate({
        target: accessGrant.email,
        set: { role: 'user', createdAt: now },
      })
    // Issue #259: one-tap approval sign-in link. Best-effort (the helper
    // swallows its own errors); the grant above has already committed.
    if (wasNew) {
      const { sendApprovalMagicLink } = await import('./auth')
      await sendApprovalMagicLink(email)
    }
    return { email, grant: 'user' }
  })

/**
 * Promote `email` to admin (role 'admin'; admin implies login access too).
 * SUPER-ADMIN-ONLY: granting/adding admins is mission-critical, so a regular
 * admin is blocked server-side (requireSuperAdmin throws 'forbidden'), not just
 * hidden in the UI. Upsert keyed on the normalised email, so it is idempotent.
 * Returns the resulting grant state.
 */
export const grantAdmin = createServerFn({ method: 'POST' })
  .inputValidator((d: { email: string }) => d)
  .handler(async ({ data }): Promise<{ email: string; grant: GrantState }> => {
    await requireSuperAdmin()
    const { normalizeEmail } = await import('./access-rules')
    const email = normalizeEmail(data.email)
    if (!email) throw new Error('email required')
    const { getDb } = await import('../db/client')
    const { accessGrant } = await import('../db/access-grant-schema')
    const db = await getDb()
    const now = new Date()
    await db
      .insert(accessGrant)
      .values({ email, role: 'admin', createdAt: now })
      .onConflictDoUpdate({
        target: accessGrant.email,
        set: { role: 'admin', createdAt: now },
      })
    return { email, grant: 'admin' }
  })

/**
 * Approve EVERY pending waitlist email at once: admin-gated. Re-derives the
 * waitlist view server-side (never trusts a client-supplied list), selects the
 * approvable emails via the same pure `pendingApprovableEmails` rule the button
 * counts with, then upserts a 'user' grant for each. Reuses the exact single-
 * approve write path (onConflictDoUpdate keyed on the normalised email), so it
 * is idempotent and never downgrades an existing admin (admins aren't approvable,
 * so they're excluded up front). Returns how many emails were newly approvable.
 */
export const approveAllWaitlist = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: true; approved: number }> => {
    const viewer = await adminViewer()
    if (!viewer) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { waitlist } = await import('../db/waitlist-schema')
    const { accessGrant } = await import('../db/access-grant-schema')
    const db = await getDb()

    const rows = await db
      .select({ email: waitlist.email, createdAt: waitlist.createdAt })
      .from(waitlist)
    const grants = await loadAdminGrantMap()
    const { envAdmins } = await loadEnvAdmins()
    const view = shapeWaitlist(rows, grants, {
      email: viewer.email,
      isSuperAdmin: viewer.isSuperAdmin,
      envAdmins,
    })
    const emails = pendingApprovableEmails(view.rows)
    if (emails.length === 0) return { ok: true, approved: 0 }

    const { normalizeEmail } = await import('./access-rules')
    const { sendApprovalMagicLink } = await import('./auth')
    const now = new Date()
    // One upsert per email (each is a tiny single-row write, well under D1's
    // bound-param limit). Same write the single "Approve as user" uses.
    // `pendingApprovableEmails` already excludes existing 'user'/'admin' grants,
    // so every email here is a genuinely new approval and earns an approval link
    // (issue #259). Best-effort per email: the helper swallows its own errors so
    // one failed send never aborts the batch or the response count.
    for (const raw of emails) {
      const email = normalizeEmail(raw)
      if (!email) continue
      await db
        .insert(accessGrant)
        .values({ email, role: 'user', createdAt: now })
        .onConflictDoUpdate({
          target: accessGrant.email,
          set: { role: 'user', createdAt: now },
        })
      await sendApprovalMagicLink(email)
    }
    return { ok: true, approved: emails.length }
  },
)

// ---------------------------------------------------------------------------
// Reset to fresh: wipe a user's (or every user's) household data so they
// re-onboard on next open. The old recommender left stale badges / inferred
// taste behind; a reset clears every household-scoped row so onboarding's
// hasHousehold guard fires again. D1 does NOT cascade foreign keys, so each
// child table is deleted EXPLICITLY (child-before-parent) before the household
// row. Auth (user/session) + admin config (access_grant / admin_notification_pref)
// are never touched, so the person stays signed in and admin grants survive.
// The delete plan lives in the pure reset-plan.ts module (single source of truth).
// ---------------------------------------------------------------------------

/** The DB client type, named via a helper so the executor can reference it. */
async function getDbForReset() {
  const { getDb } = await import('../db/client')
  return getDb()
}

/** The household-scoped Drizzle tables the reset deletes from. */
interface ResetTables {
  household: typeof householdTable
  mealPlan: typeof mealPlanTable
  recipeSwipe: typeof recipeSwipeTable
  mealFeedback: typeof mealFeedbackTable
  householdMemory: typeof householdMemoryTable
  shoppingListItem: typeof shoppingListItemTable
  staple: typeof stapleTable
  pushSubscription: typeof pushSubscriptionTable
}

/** Load every household-scoped table the reset deletes from. */
async function loadResetTables(): Promise<ResetTables> {
  const { household, mealPlan, recipeSwipe, mealFeedback, householdMemory } =
    await import('../db/schema')
  const { shoppingListItem } = await import('../db/shopping-list-schema')
  const { staple } = await import('../db/staples-schema')
  const { pushSubscription } = await import('../db/push-subscription-schema')
  return {
    household,
    mealPlan,
    recipeSwipe,
    mealFeedback,
    householdMemory,
    shoppingListItem,
    staple,
    pushSubscription,
  }
}

/**
 * Build a Drizzle-backed reset executor: maps each child-table key from the pure
 * plan to its real Drizzle delete (keyed by household_id), and the household
 * delete to a delete by the household's own id.
 *
 * D1 caps a statement at 100 bound params; every delete here is a single-column
 * equality (one bound param), so there is no param pressure however many rows a
 * delete touches.
 */
async function makeResetExecutor(
  db: Awaited<ReturnType<typeof getDbForReset>>,
  tables: ResetTables,
): Promise<ResetExecutor> {
  const { eq } = await import('drizzle-orm')
  // Map each plan table key to its Drizzle table + the household_id column the
  // delete filters on. Typed loosely (the column as AnySQLiteColumn) because the
  // six tables have different row shapes; the executor only ever filters by id.
  const childTable: Record<
    HouseholdScopedTable,
    { table: Parameters<typeof db.delete>[0]; householdId: AnySQLiteColumn }
  > = {
    recipe_swipe: {
      table: tables.recipeSwipe,
      householdId: tables.recipeSwipe.householdId,
    },
    meal_feedback: {
      table: tables.mealFeedback,
      householdId: tables.mealFeedback.householdId,
    },
    household_memory: {
      table: tables.householdMemory,
      householdId: tables.householdMemory.householdId,
    },
    meal_plan: {
      table: tables.mealPlan,
      householdId: tables.mealPlan.householdId,
    },
    shopping_list_item: {
      table: tables.shoppingListItem,
      householdId: tables.shoppingListItem.householdId,
    },
    staple: { table: tables.staple, householdId: tables.staple.householdId },
    push_subscription: {
      table: tables.pushSubscription,
      householdId: tables.pushSubscription.householdId,
    },
  }
  return {
    async clearChild(table, householdId) {
      const { table: t, householdId: col } = childTable[table]
      await db.delete(t).where(eq(col, householdId))
    },
    async deleteHousehold(householdId) {
      await db
        .delete(tables.household)
        .where(eq(tables.household.id, householdId))
    },
  }
}

/**
 * Delete every household-scoped row for ONE household (child tables first), then
 * the household row, by walking the pure reset plan against a Drizzle executor.
 * Shared by resetUserData (one household) and resetAllUsersData (looped).
 */
async function wipeHousehold(
  db: Awaited<ReturnType<typeof getDbForReset>>,
  tables: ResetTables,
  householdId: string,
) {
  const exec = await makeResetExecutor(db, tables)
  await executeReset(exec, householdId)
}

/**
 * Reset ONE user to fresh: admin-gated. Resolve the user's household, then wipe
 * every household-scoped row (explicit per-table deletes, no FK cascade on D1)
 * and finally the household row. The auth user/session is left intact, so the
 * person stays signed in but has no household; the route guards then send them
 * to /onboarding on next open. No-op (ok:false) if the user has no household.
 *
 * `wasSelf` reports whether the admin reset their OWN account, so the panel can
 * drop them straight into /onboarding (the gate is now stale in the live router
 * for the current session) instead of waiting for a manual reload.
 */
export const resetUserData = createServerFn({ method: 'POST' })
  .inputValidator((d: { userId: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{
      ok: boolean
      householdId: string | null
      wasSelf: boolean
    }> => {
      const viewer = await adminUser()
      if (!viewer) throw new Error('forbidden')
      const wasSelf = viewer.id === data.userId
      const { eq } = await import('drizzle-orm')
      const tables = await loadResetTables()
      const db = await getDbForReset()
      const hh = (
        await db
          .select({ id: tables.household.id })
          .from(tables.household)
          .where(eq(tables.household.ownerId, data.userId))
          .limit(1)
      )[0]
      if (!hh) return { ok: false, householdId: null, wasSelf }
      await wipeHousehold(db, tables, hh.id)
      return { ok: true, householdId: hh.id, wasSelf }
    },
  )

/**
 * Reset ALL users to fresh: SUPER-ADMIN-gated (this is destructive). Wipe every
 * household-scoped row across every household, then every household row. We loop
 * per household so the deletes stay child-before-parent and each delete is a
 * single-param statement (well under D1's 100-bound-param limit). Auth + admin
 * config are untouched, so everyone stays signed in and admin grants survive.
 * Returns how many households were cleared.
 */
export const resetAllUsersData = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: true; householdsCleared: number }> => {
    const viewer = await adminViewer()
    if (!viewer || !viewer.isSuperAdmin) throw new Error('forbidden')
    const tables = await loadResetTables()
    const db = await getDbForReset()
    const households = await db
      .select({ id: tables.household.id })
      .from(tables.household)
    for (const hh of households) {
      await wipeHousehold(db, tables, hh.id)
    }
    return { ok: true, householdsCleared: households.length }
  },
)

export interface Datapoint {
  recipeTitle: string
  cuisine: string | null
  direction: string
  at: string
}
export interface UserDatapoints {
  email: string
  badges: Array<Badge>
  lovedTastes: Array<string>
  dislikes: Array<string>
  swipes: Array<Datapoint>
}

export const getUserDatapoints = createServerFn({ method: 'POST' })
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data }): Promise<UserDatapoints | null> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { user, household, recipeSwipe, recipe } =
      await import('../db/schema')
    const { eq, desc } = await import('drizzle-orm')
    const db = await getDb()
    const u = (
      await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, data.userId))
        .limit(1)
    )[0]
    if (!u) return null
    const hh = (
      await db
        .select({ id: household.id, profile: household.profile })
        .from(household)
        .where(eq(household.ownerId, data.userId))
        .limit(1)
    )[0]
    const swipes = hh
      ? await db
          .select({
            recipeTitle: recipe.title,
            cuisine: recipe.cuisine,
            direction: recipeSwipe.direction,
            at: recipeSwipe.createdAt,
          })
          .from(recipeSwipe)
          .innerJoin(recipe, eq(recipe.id, recipeSwipe.recipeId))
          .where(eq(recipeSwipe.householdId, hh.id))
          .orderBy(desc(recipeSwipe.createdAt))
      : []
    const profile = hh?.profile
    return {
      email: u.email,
      badges: profile ? deriveBadges(profile) : [],
      lovedTastes: profile?.lovedTastes ?? [],
      dislikes: profile?.dislikes ?? [],
      swipes: swipes.map((s) => ({
        recipeTitle: s.recipeTitle,
        cuisine: s.cuisine,
        direction: s.direction,
        at: s.at instanceof Date ? s.at.toISOString() : String(s.at),
      })),
    }
  })

// ---------------------------------------------------------------------------
// Benchmark console: run the swipe benchmark over the FROZEN fixture on demand,
// switch algorithm, tune the Adaptive weights, compare against the committed
// baseline. All recsys + node-only (fixture-on-disk) code is pulled in via
// dynamic import() so it never leaks into the client bundle.
// ---------------------------------------------------------------------------

/** A single baselined algorithm row (mirrors docs/benchmarks/baseline.json). */
export interface BaselineAlgo {
  recallByCheckpoint: Record<string, number>
  medianSwipesToTarget: number | null
}

/** What the Benchmark tab needs to render its controls before any run. */
export interface BenchmarkMeta {
  /** Registered algorithm keys, in registration order (auto-includes new strategies). */
  algorithms: Array<string>
  /** The live default algorithm key. */
  defaultAlgorithm: string
  /** The default Adaptive weights, used to seed the numeric inputs. */
  defaultWeights: AdaptiveWeights
  /** The committed baseline: recall@checkpoint per algorithm + the checkpoints + metric. */
  baseline: {
    metric: string
    checkpoints: Array<number>
    algorithms: Record<string, BaselineAlgo>
  }
}

export const getBenchmarkMeta = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BenchmarkMeta> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { registeredKeys } = await import('./recsys/registry')
    const { DEFAULT_ALGORITHM, DEFAULT_ADAPTIVE_WEIGHTS } =
      await import('./recsys/config')
    const baselineRaw = benchmarkBaseline as {
      metric: string
      checkpoints: Array<number>
      algorithms: Record<string, BaselineAlgo>
    }
    return {
      algorithms: registeredKeys(),
      defaultAlgorithm: DEFAULT_ALGORITHM,
      defaultWeights: DEFAULT_ADAPTIVE_WEIGHTS,
      baseline: {
        metric: baselineRaw.metric,
        checkpoints: baselineRaw.checkpoints,
        algorithms: baselineRaw.algorithms,
      },
    }
  },
)

/** Input for a single fast benchmark run. */
export interface RunBenchmarkInput {
  /** Registered algorithm key to run. */
  algorithm: string
  /** Optional Adaptive weight overrides (only affects the `adaptive` algorithm). */
  weights?: AdaptiveWeights
  /** How many synthetic users to sample. Capped server-side so a run stays fast. */
  userLimit?: number
}

export interface RunBenchmarkResult {
  key: string
  name: string
  recallByCheckpoint: Record<number, number>
  medianSwipesToTarget: number | null
  pctReachedTarget: number
  usersScored: number
  /** Checkpoints actually measured (aligned to the baseline's checkpoints). */
  checkpoints: Array<number>
  /** Wall-clock duration of the run in milliseconds. */
  ranMs: number
}

/**
 * Run ONE algorithm over a sub-sample of the frozen fixture, fast. The user limit is
 * clamped to [10, 80] so an admin can never trigger a 60s full run from the browser:
 * the fast path scores a few dozen users up to the baseline's largest checkpoint and
 * returns in a couple of seconds. Deterministic (seeded), no DB, no network.
 */
export const runBenchmarkFast = createServerFn({ method: 'POST' })
  .inputValidator((d: RunBenchmarkInput) => d)
  .handler(async ({ data }): Promise<RunBenchmarkResult> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { isRegistered } = await import('./recsys/registry')
    if (!isRegistered(data.algorithm)) {
      throw new Error(`Unknown algorithm "${data.algorithm}"`)
    }
    const { loadBenchmarkFixture } = await import('./recsys/fixture')
    const { runSingleAlgorithm } = await import('./recsys/benchmark-core')
    const checkpoints = (benchmarkBaseline as { checkpoints: Array<number> })
      .checkpoints
    const userLimit = Math.min(80, Math.max(10, data.userLimit ?? 40))

    // The frozen fixture is read from disk (fixture.ts), which only works where
    // there's a filesystem, local dev / Node. On the edge there is none, so a
    // benchmark RUN is a local-dev tool; surface a clear message instead of a 500.
    // (The /admin page + every other tab work in prod; only this button is local.)
    let recipes: Array<RecipeLite>
    let users: Array<UserProfile>
    try {
      ;({ recipes, users } = loadBenchmarkFixture())
    } catch {
      throw new Error(
        'The benchmark runs in local dev only (no filesystem on the edge). Run it with `npm run start`.',
      )
    }
    const started = Date.now()
    const result = runSingleAlgorithm(recipes, users, data.algorithm, {
      checkpoints,
      userLimit,
      weights: data.weights,
    })
    return {
      key: result.key,
      name: result.name,
      recallByCheckpoint: result.recallByCheckpoint,
      medianSwipesToTarget: result.medianSwipesToTarget,
      pctReachedTarget: result.pctReachedTarget,
      usersScored: result.usersScored,
      checkpoints,
      ranMs: Date.now() - started,
    }
  })

// ---------------------------------------------------------------------------
// Real-feedback fold-in: see a REAL household's ranking + inferred taste WITH
// vs WITHOUT its post-meal feedback folded on top of the onboarding swipes.
// The synthetic-fixture benchmark above stays the baseline; this is the
// on-top-of, live-data view. Real households are the ones that have actually
// left meal_feedback (only there does the toggle change anything).
// ---------------------------------------------------------------------------

/** A household the admin can run the with/without-feedback comparison on. */
export interface RealFeedbackHousehold {
  userId: string
  email: string
  householdId: string
  swipes: number
  feedback: number
}

/**
 * List households that have at least one post-meal feedback row. Those are the
 * only ones where folding real feedback changes the ranking, so the console
 * picker offers exactly them (synthetic seeded users have no meal_feedback).
 */
export const listRealFeedbackHouseholds = createServerFn({
  method: 'GET',
}).handler(async (): Promise<Array<RealFeedbackHousehold>> => {
  if (!(await adminUser())) throw new Error('forbidden')
  const { getDb } = await import('../db/client')
  const { user, household, recipeSwipe, mealFeedback } =
    await import('../db/schema')
  const { eq, count, inArray } = await import('drizzle-orm')
  const db = await getDb()

  const fbCounts = await db
    .select({ hid: mealFeedback.householdId, n: count() })
    .from(mealFeedback)
    .groupBy(mealFeedback.householdId)
  if (fbCounts.length === 0) return []
  const hids = fbCounts.map((c) => c.hid)
  const fbByHid = new Map(fbCounts.map((c) => [c.hid, c.n]))

  const rows = await db
    .select({
      householdId: household.id,
      userId: user.id,
      email: user.email,
    })
    .from(household)
    .innerJoin(user, eq(user.id, household.ownerId))
    .where(inArray(household.id, hids))

  const swipeCounts = await db
    .select({ hid: recipeSwipe.householdId, n: count() })
    .from(recipeSwipe)
    .where(inArray(recipeSwipe.householdId, hids))
    .groupBy(recipeSwipe.householdId)
  const swByHid = new Map(swipeCounts.map((c) => [c.hid, c.n]))

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    householdId: r.householdId,
    swipes: swByHid.get(r.householdId) ?? 0,
    feedback: fbByHid.get(r.householdId) ?? 0,
  }))
})

/** One recommended recipe in a household-ranking comparison. */
export interface RankedRecipe {
  id: string
  title: string
  cuisine: string | null
}

/** A household's inferred taste + top recommendations under one observation set. */
export interface RankingView {
  taste: InferredTaste
  topRecipes: Array<RankedRecipe>
}

/** The with/without-feedback comparison for one real household. */
export interface RealFeedbackComparison {
  email: string
  householdId: string
  /** What folding the real feedback added over the onboarding swipes. */
  fold: FoldStats
  /** Ranking from onboarding swipes only (the baseline). */
  withoutFeedback: RankingView
  /** Ranking with post-meal feedback folded on top. Same when fold adds nothing. */
  withFeedback: RankingView
}

/** Input: which household, and how many top recipes to show. */
export interface CompareRealFeedbackInput {
  householdId: string
  topN?: number
}

/**
 * Rank a REAL household's catalogue twice — onboarding-only, then with its
 * post-meal feedback folded on top — and return both inferred tastes + top-N
 * recommendations so the console can show the effect side by side. Uses the live
 * default algorithm so the comparison matches what the planner actually does.
 * Pure recsys + node-only code is dynamically imported (no client-bundle leak).
 */
export const compareRealFeedback = createServerFn({ method: 'POST' })
  .inputValidator((d: CompareRealFeedbackInput) => d)
  .handler(async ({ data }): Promise<RealFeedbackComparison> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { user, household, recipeSwipe, mealFeedback } =
      await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const { loadCatalogue } = await import('./recsys-data')
    const { makeRecommender } = await import('./recsys/registry')
    const { DEFAULT_ALGORITHM } = await import('./recsys/config')
    const { foldRealFeedback, foldStats } =
      await import('./recsys/feedback-fold')
    const db = await getDb()

    const hh = (
      await db
        .select({ id: household.id, ownerId: household.ownerId })
        .from(household)
        .where(eq(household.id, data.householdId))
        .limit(1)
    )[0]
    if (!hh) throw new Error('household not found')
    const owner = (
      await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, hh.ownerId))
        .limit(1)
    )[0]

    const swipeRows = await db
      .select({
        recipeId: recipeSwipe.recipeId,
        direction: recipeSwipe.direction,
      })
      .from(recipeSwipe)
      .where(eq(recipeSwipe.householdId, hh.id))
    const onboardingSwipes = swipeRows
      .filter((s) => s.direction === 'like' || s.direction === 'dislike')
      .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

    const fbRows = await db
      .select({
        recipeId: mealFeedback.recipeId,
        rating: mealFeedback.rating,
      })
      .from(mealFeedback)
      .where(eq(mealFeedback.householdId, hh.id))
      .orderBy(mealFeedback.createdAt)
    const feedback = fbRows
      .filter((f): f is { recipeId: string; rating: string } =>
        Boolean(f.recipeId),
      )
      .map((f) => ({ recipeId: f.recipeId, rating: f.rating }))

    const foldedSwipes = foldRealFeedback(onboardingSwipes, feedback)
    const fold = foldStats(onboardingSwipes, feedback)

    const { recipes } = await loadCatalogue()
    const topN = Math.min(20, Math.max(1, data.topN ?? 7))
    const rec = makeRecommender(DEFAULT_ALGORITHM, recipes)

    const view = (swipes: typeof onboardingSwipes): RankingView => ({
      taste: rec.explain(swipes),
      topRecipes: rec.recommend(swipes, topN).map((r) => ({
        id: r.id,
        title: r.title,
        cuisine: r.cuisine,
      })),
    })

    return {
      email: owner?.email ?? '(unknown)',
      householdId: hh.id,
      fold,
      withoutFeedback: view(onboardingSwipes),
      withFeedback: view(foldedSwipes),
    }
  })

// ---------------------------------------------------------------------------
// Explainability: for ONE real user, show WHY recipes were chosen as a
// data-point graph — their swipes (data points) feed the inferred tastes which
// drive the top recommendations, and each recommendation carries the signals
// that placed it. Uses the live default algorithm so the explanation matches
// what the planner actually does. All recsys + node-only code is dynamically
// imported so it never leaks into the client bundle.
// ---------------------------------------------------------------------------

/** Re-export the shaped payload so the route + component import from one place. */
export type { UserExplanation } from './recsys/explain-why'
export type {
  RecipeWhy,
  WhySignal,
  WhyDatapoint,
  InferredPreference,
} from './recsys/explain-why'

/** Input: which user, and how many top recommendations to explain. */
export interface ExplainUserInput {
  userId: string
  topN?: number
}

export const explainUser = createServerFn({ method: 'POST' })
  .inputValidator((d: ExplainUserInput) => d)
  .handler(async ({ data }): Promise<UserExplanation | null> => {
    if (!(await adminUser())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { user, household, recipeSwipe } = await import('../db/schema')
    const { eq, desc } = await import('drizzle-orm')
    const { loadCatalogue } = await import('./recsys-data')
    const { makeRecommender } = await import('./recsys/registry')
    const { DEFAULT_ALGORITHM } = await import('./recsys/config')
    const { recipeWhys, shapePreferences } =
      await import('./recsys/explain-why')
    const db = await getDb()

    const u = (
      await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, data.userId))
        .limit(1)
    )[0]
    if (!u) return null
    const hh = (
      await db
        .select({ id: household.id })
        .from(household)
        .where(eq(household.ownerId, data.userId))
        .limit(1)
    )[0]

    const swipeRows = hh
      ? await db
          .select({
            recipeId: recipeSwipe.recipeId,
            direction: recipeSwipe.direction,
          })
          .from(recipeSwipe)
          .where(eq(recipeSwipe.householdId, hh.id))
          .orderBy(desc(recipeSwipe.createdAt))
      : []

    const swipes = swipeRows
      .filter((s) => s.direction === 'like' || s.direction === 'dislike')
      .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

    const { recipes } = await loadCatalogue()
    const byId = new Map(recipes.map((r) => [r.id, r]))
    const topN = Math.min(20, Math.max(1, data.topN ?? 8))
    const rec = makeRecommender(DEFAULT_ALGORITHM, recipes)

    const taste = rec.explain(swipes)
    const likedRecipes = swipes
      .filter((s) => s.like)
      .map((s) => byId.get(s.recipeId))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
    const topRecipes = rec.recommend(swipes, topN)

    const datapoints = swipes.map((s) => {
      const r = byId.get(s.recipeId)
      return {
        recipeTitle: r?.title ?? '(unknown recipe)',
        cuisine: r?.cuisine ?? null,
        like: s.like,
      }
    })

    return {
      email: u.email,
      datapoints,
      preferences: shapePreferences(taste, likedRecipes),
      recommendations: recipeWhys(topRecipes, taste),
    }
  })
