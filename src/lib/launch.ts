/**
 * App launch-state read helpers. Server-only: `readLaunchState` dynamically
 * imports the DB client so this never reaches the client bundle, mirroring the
 * `loadGrantMap` pattern in access.ts. The pure `dedupeEmails` has no imports so
 * it is unit-testable and shared by the broadcast recipient build.
 */

/** The single launch-state row scope (mirrors payment-mode's GLOBAL_SCOPE). */
export const LAUNCH_SCOPE = 'global'

export interface LaunchState {
  launched: boolean
  launchedAt: Date | null
}

/**
 * Read the global launch state. Reads the single `scope='global'` row and
 * returns its flag. Degrades to `{ launched: false }` on ANY error (e.g. the
 * migration not yet applied), so a missing table keeps the app in waitlist mode
 * rather than throwing out of the sign-in gate or the landing loader.
 */
export async function readLaunchState(): Promise<LaunchState> {
  try {
    const { getDb } = await import('../db/client')
    const { launchState } = await import('../db/launch-state-schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const row = (
      await db
        .select({
          launched: launchState.launched,
          launchedAt: launchState.launchedAt,
        })
        .from(launchState)
        .where(eq(launchState.scope, LAUNCH_SCOPE))
        .limit(1)
    )[0]
    return {
      launched: Boolean(row?.launched),
      launchedAt: row?.launchedAt ?? null,
    }
  } catch {
    return { launched: false, launchedAt: null }
  }
}

/**
 * Merge any number of email lists into ONE normalised, de-duplicated list:
 * trim + lowercase each, drop blanks, keep first-seen order. Pure (no imports)
 * so the launch broadcast's recipient set is unit-testable. Used to union the
 * waitlist emails with the registered-user emails before sending the live email.
 */
export function dedupeEmails(...lists: Array<Array<string>>): Array<string> {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const list of lists) {
    for (const raw of list) {
      const e = raw.trim().toLowerCase()
      if (!e || seen.has(e)) continue
      seen.add(e)
      out.push(e)
    }
  }
  return out
}
