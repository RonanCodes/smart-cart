import { createServerFn } from '@tanstack/react-start'
import { isFlagKey } from './flags'
import type { FlagKey, FlagSet } from './flags'

/**
 * Feature-flag createServerFns. The read (`getFlags`) is UNGATED — it returns one
 * set of booleans the whole app needs to render the store pickers / order bar /
 * tip prompt, bootstrapped to the client via the root loader. The write
 * (`setFlags`) is admin-gated, mirroring launch-server's setLaunchState.
 *
 * The actual D1 read lives in flags-read.ts and is reached ONLY via a dynamic
 * import() inside these handlers, so its transitive db/client (which imports
 * `cloudflare:workers`) never enters the client bundle — `__root` statically
 * imports getFlags from here, so this module's top level must stay client-safe.
 */

/**
 * The resolved flag set for the root loader + any surface that needs it.
 * Ungated, read-only. Degrades to defaults inside readFlags, so this never
 * throws out of the root loader (which runs on every page, including the public
 * landing).
 */
export const getFlags = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FlagSet> => {
    const { readFlags } = await import('./flags-read')
    return readFlags()
  },
)

/** Gate: the signed-in viewer must be an admin, or this throws 'forbidden'. */
async function requireAdmin(): Promise<void> {
  const { isAdmin } = await import('./admin-server')
  if (!(await isAdmin())) throw new Error('forbidden')
}

/**
 * Set one or more flags, then return the resulting full flag set. ADMIN-gated.
 * Each update upserts a single feature_flag row keyed on the flag key, so it is
 * idempotent. Unknown keys are rejected by the validator (isFlagKey), so junk
 * can never create a stray row. A single setFlags call carries both the per-flag
 * toggle and the "disable all ordering" master action (many keys at once).
 */
export const setFlags = createServerFn({ method: 'POST' })
  .inputValidator(
    (d: { updates: Array<{ key: string; enabled: unknown }> }) => {
      const updates: Array<{ key: FlagKey; enabled: boolean }> = []
      const incoming = Array.isArray(d.updates) ? d.updates : []
      for (const u of incoming) {
        if (!isFlagKey(u.key)) throw new Error(`Unknown flag "${u.key}"`)
        updates.push({ key: u.key, enabled: Boolean(u.enabled) })
      }
      if (updates.length === 0) throw new Error('No flag updates')
      return { updates }
    },
  )
  .handler(async ({ data }): Promise<FlagSet> => {
    await requireAdmin()
    const { getDb } = await import('../db/client')
    const { featureFlag } = await import('../db/feature-flag-schema')
    const db = await getDb()
    const now = new Date()
    for (const { key, enabled } of data.updates) {
      await db
        .insert(featureFlag)
        .values({ key, enabled, updatedAt: now })
        .onConflictDoUpdate({
          target: featureFlag.key,
          set: { enabled, updatedAt: now },
        })
    }
    const { readFlags } = await import('./flags-read')
    return readFlags()
  })
