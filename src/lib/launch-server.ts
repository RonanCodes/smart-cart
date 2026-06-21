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
 * Flip the global launch state. Admin-gated. Upserts the single scope='global'
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
      await requireAdmin()
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
