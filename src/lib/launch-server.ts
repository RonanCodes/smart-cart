import { createServerFn } from '@tanstack/react-start'
import { LAUNCH_SCOPE } from './launch'

/**
 * Launch-state createServerFns for the /admin Launch panel. The read
 * (`getLaunchState`) is intentionally UNGATED: it returns one public boolean the
 * marketing landing needs to decide whether to show the waitlist form. The write
 * (`setLaunchState`) is admin-gated, mirroring payment-mode-server.ts. The
 * server-only DB read + the pure `dedupeEmails` live in launch.ts so nothing
 * server-only reaches the browser bundle.
 */

/** Gate: the signed-in viewer must be an admin, or this throws 'forbidden'. */
async function requireAdmin(): Promise<void> {
  const { isAdmin } = await import('./admin-server')
  if (!(await isAdmin())) throw new Error('forbidden')
}

/**
 * Gate: the signed-in viewer must be a SUPER-admin, or this throws 'forbidden'.
 * Used by the mission-critical launch actions — flipping the site live / back to
 * waitlist (setLaunchState) and the launch-email broadcast
 * (sendLaunchEmailToAllUsers / the setLaunchState notify path) — so a regular
 * admin is blocked server-side, not merely hidden in the UI. Reuses the
 * server-decided `isSuperAdmin` server fn (adminViewer + isSuperAdminWith) in
 * admin-server.ts.
 */
async function requireSuperAdmin(): Promise<void> {
  const { isSuperAdmin } = await import('./admin-server')
  if (!(await isSuperAdmin())) throw new Error('forbidden')
}

export interface LaunchStateView {
  launched: boolean
  /** Epoch millis of first go-live, or null. Serialisable across the fn boundary. */
  launchedAt: number | null
}

/**
 * The current launch state for the admin panel AND the public landing. Ungated.
 * Reads the single global row via readLaunchState (degrades to not-launched on
 * any error). `launchedAt` is returned as epoch millis so it crosses the server-
 * fn boundary cleanly.
 */
export const getLaunchState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LaunchStateView> => {
    const { readLaunchState } = await import('./launch')
    const state = await readLaunchState()
    return {
      launched: state.launched,
      launchedAt: state.launchedAt ? state.launchedAt.getTime() : null,
    }
  },
)

/**
 * Flip the global launch state. SUPER-ADMIN-gated. Upserts the single scope='global'
 * row; `launchedAt` is stamped on the first go-live and preserved thereafter.
 *
 * When going live with `notify` set, every email we know about (waitlist ∪
 * registered users, de-duped) gets the "Souso is live" email, best-effort: one
 * failed send never aborts the rest, matching approveAllWaitlist. Reverting to
 * waitlist mode (`launched: false`) never emails. Returns the resulting flag and
 * how many people were emailed.
 */
export const setLaunchState = createServerFn({ method: 'POST' })
  .inputValidator((d: { launched: boolean; notify: boolean }) => ({
    launched: Boolean(d.launched),
    notify: Boolean(d.notify),
  }))
  .handler(
    async ({ data }): Promise<{ launched: boolean; notified: number }> => {
      // SUPER-ADMIN-ONLY: toggling the site live / back to waitlist (and the
      // notify broadcast it can trigger) is mission-critical.
      await requireSuperAdmin()
      const { getDb } = await import('../db/client')
      const { launchState } = await import('../db/launch-state-schema')
      const { eq } = await import('drizzle-orm')
      const db = await getDb()
      const now = new Date()

      // Stamp launchedAt only on the first go-live; keep the original date if a
      // row already records it (so a revert-then-relaunch doesn't reset history).
      const existing = (
        await db
          .select({ launchedAt: launchState.launchedAt })
          .from(launchState)
          .where(eq(launchState.scope, LAUNCH_SCOPE))
          .limit(1)
      )[0]
      const launchedAt = data.launched
        ? (existing?.launchedAt ?? now)
        : (existing?.launchedAt ?? null)

      await db
        .insert(launchState)
        .values({
          scope: LAUNCH_SCOPE,
          launched: data.launched,
          launchedAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: launchState.scope,
          set: { launched: data.launched, launchedAt, updatedAt: now },
        })

      if (!(data.launched && data.notify))
        return { launched: data.launched, notified: 0 }

      // Gather every email we can reach: waitlist signups ∪ registered users.
      const { waitlist } = await import('../db/waitlist-schema')
      const { user } = await import('../db/schema')
      const { dedupeEmails } = await import('./launch')
      const [waitRows, userRows] = await Promise.all([
        db.select({ email: waitlist.email }).from(waitlist),
        db.select({ email: user.email }).from(user),
      ])
      const recipients = dedupeEmails(
        waitRows.map((r) => r.email),
        userRows.map((r) => r.email),
      )

      const { readEnv } = await import('./env')
      const base =
        (await readEnv('BETTER_AUTH_URL')) ??
        'https://smartcart.ronanconnolly.dev'
      const signInUrl = `${base.replace(/\/$/, '')}/sign-in`

      const { sendLaunchEmail } = await import('./email')
      let notified = 0
      for (const email of recipients) {
        try {
          const { sent } = await sendLaunchEmail(email, signInUrl)
          if (sent) notified += 1
        } catch (err) {
          // Best-effort: one bad address must not abort the broadcast.
          console.error('sendLaunchEmail failed (continuing):', email, err)
        }
      }
      return { launched: data.launched, notified }
    },
  )

/** The launch email preview the admin broadcast panel renders beside the button:
 * the exact subject + body that will be sent, plus the de-duped recipient count
 * (every registered user's email). `signInUrl` shows where "Open Souso" points. */
export interface LaunchEmailPreview {
  subject: string
  body: string
  signInUrl: string
  recipientCount: number
}

/** Build the /sign-in URL from BETTER_AUTH_URL (falls back to the live host). */
async function resolveSignInUrl(): Promise<string> {
  const { readEnv } = await import('./env')
  const base =
    (await readEnv('BETTER_AUTH_URL')) ?? 'https://smartcart.ronanconnolly.dev'
  return `${base.replace(/\/$/, '')}/sign-in`
}

/**
 * Admin-gated preview for the "email all users: we're live" panel. Returns the
 * exact launch subject + body copy (single source of truth in email.ts) and the
 * count of unique registered-user emails it would send to, so the admin can
 * review everything before confirming. Read-only: sends nothing.
 */
export const getLaunchEmailPreview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LaunchEmailPreview> => {
    await requireAdmin()
    const { getDb } = await import('../db/client')
    const { user } = await import('../db/schema')
    const { dedupeEmails } = await import('./launch')
    const { LAUNCH_EMAIL_SUBJECT, launchEmailText } = await import('./email')
    const db = await getDb()
    const signInUrl = await resolveSignInUrl()
    const userRows = await db.select({ email: user.email }).from(user)
    const recipients = dedupeEmails(userRows.map((r) => r.email))
    return {
      subject: LAUNCH_EMAIL_SUBJECT,
      body: launchEmailText(signInUrl),
      signInUrl,
      recipientCount: recipients.length,
    }
  },
)

/**
 * Send the "Souso is live" launch email to EVERY registered user.
 * SUPER-ADMIN-gated (mission-critical broadcast; throws 'forbidden' otherwise),
 * POST so it never fires on load. Iterates the
 * de-duped `user` table emails and sends best-effort: one failed address never
 * aborts the rest. Returns { sent, failed, total } so the panel can report the
 * outcome. Use this to (re)send the launch email after go-live, independent of
 * the launch-state toggle. Never sends unless the admin explicitly invokes it.
 */
export const sendLaunchEmailToAllUsers = createServerFn({
  method: 'POST',
}).handler(
  async (): Promise<{ sent: number; failed: number; total: number }> => {
    await requireSuperAdmin()
    const { getDb } = await import('../db/client')
    const { user } = await import('../db/schema')
    const { dedupeEmails } = await import('./launch')
    const db = await getDb()
    const userRows = await db.select({ email: user.email }).from(user)
    const recipients = dedupeEmails(userRows.map((r) => r.email))
    const signInUrl = await resolveSignInUrl()

    const { sendLaunchEmail } = await import('./email')
    let sent = 0
    let failed = 0
    for (const email of recipients) {
      try {
        const res = await sendLaunchEmail(email, signInUrl)
        if (res.sent) sent += 1
        else failed += 1
      } catch (err) {
        // Best-effort: one bad address must not abort the broadcast.
        failed += 1
        console.error('sendLaunchEmail failed (continuing):', email, err)
      }
    }
    return { sent, failed, total: recipients.length }
  },
)
