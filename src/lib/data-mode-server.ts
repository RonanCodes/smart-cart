import { createServerFn } from '@tanstack/react-start'
import { GLOBAL_SCOPE, asDataMode, requireDataMode } from './data-mode'
import type { DataMode } from './data-mode'

/**
 * Admin-gated data-mode createServerFns (read + write the data_mode table from
 * the /admin Demo-data panel). The pure validators/types live in data-mode.ts
 * (client-safe) and the DB resolver in data-mode-resolve.ts (server-only). The
 * DataModePanel imports the server fns from here (handlers stripped client-side)
 * + the pure helpers/types from data-mode, so nothing server-only reaches the
 * browser bundle.
 */

// Re-export the pure helpers/types so callers can import the whole data-mode
// surface from one place (the panel imports types from here).
export {
  GLOBAL_SCOPE,
  asDataMode,
  requireDataMode,
  householdWriteOp,
} from './data-mode'
export type { DataMode } from './data-mode'

/** Gate: the signed-in viewer must be an admin, or this throws 'forbidden'. */
async function requireAdmin(): Promise<void> {
  const { isAdmin } = await import('./admin-server')
  if (!(await isAdmin())) throw new Error('forbidden')
}

/** One per-household override in the admin Demo-data view. */
export interface DataModeOverride {
  householdId: string
  /** The override owner's email, or '(unknown)' if the household has no owner row. */
  email: string
  mode: DataMode
}

export interface DataModeSettings {
  /** The app-wide default mode (the global row, or 'real' when unset). */
  global: DataMode
  /** Per-household overrides, joined to the owner's email, newest write first. */
  overrides: Array<DataModeOverride>
}

/**
 * The current data-mode settings for the admin panel: the global default plus
 * every per-household override joined to its owner email. Admin-gated. Bad stored
 * modes are coerced to 'real' for display (the same safe fallback the resolver
 * uses), so the UI never shows an invalid value.
 */
export const getDataModeSettings = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DataModeSettings> => {
    await requireAdmin()
    const { getDb } = await import('../db/client')
    const { dataMode } = await import('../db/data-mode-schema')
    const { household, user } = await import('../db/schema')
    const { eq, ne, desc } = await import('drizzle-orm')
    const db = await getDb()

    const globalRow = (
      await db
        .select({ mode: dataMode.mode })
        .from(dataMode)
        .where(eq(dataMode.scope, GLOBAL_SCOPE))
        .limit(1)
    )[0]

    // Every override is a row whose scope is a householdId (anything but 'global').
    const overrideRows = await db
      .select({
        householdId: dataMode.scope,
        mode: dataMode.mode,
        email: user.email,
      })
      .from(dataMode)
      .leftJoin(household, eq(household.id, dataMode.scope))
      .leftJoin(user, eq(user.id, household.ownerId))
      .where(ne(dataMode.scope, GLOBAL_SCOPE))
      .orderBy(desc(dataMode.updatedAt))

    return {
      global: asDataMode(globalRow?.mode) ?? 'real',
      overrides: overrideRows.map((r) => ({
        householdId: r.householdId,
        email: r.email ?? '(unknown)',
        mode: asDataMode(r.mode) ?? 'real',
      })),
    }
  },
)

/**
 * Set the GLOBAL default mode. Admin-gated, strictly validated. Upserts the
 * single scope='global' row (idempotent), so flipping the default is one write.
 */
export const setGlobalDataMode = createServerFn({ method: 'POST' })
  .inputValidator((d: { mode: DataMode }) => ({
    mode: requireDataMode(d.mode),
  }))
  .handler(async ({ data }): Promise<{ global: DataMode }> => {
    await requireAdmin()
    const { getDb } = await import('../db/client')
    const { dataMode } = await import('../db/data-mode-schema')
    const db = await getDb()
    const now = new Date()
    await db
      .insert(dataMode)
      .values({ scope: GLOBAL_SCOPE, mode: data.mode, updatedAt: now })
      .onConflictDoUpdate({
        target: dataMode.scope,
        set: { mode: data.mode, updatedAt: now },
      })
    return { global: data.mode }
  })

/**
 * Set (or clear) a per-household override. Admin-gated. A mode of 'real'|'demo'
 * upserts the override row; a mode of null DELETES it, so the household falls
 * back to inheriting the global default. Returns the resulting effective mode
 * for the household so the UI can reflect inheritance after a clear.
 */
export const setHouseholdDataMode = createServerFn({ method: 'POST' })
  .inputValidator((d: { householdId: string; mode: DataMode | null }) => ({
    householdId: String(d.householdId),
    // null = inherit (clear the override). Anything else must be a valid mode.
    mode: d.mode === null ? null : requireDataMode(d.mode),
  }))
  .handler(
    async ({
      data,
    }): Promise<{
      householdId: string
      override: DataMode | null
      effective: DataMode
    }> => {
      await requireAdmin()
      if (!data.householdId) throw new Error('householdId required')
      const { getDb } = await import('../db/client')
      const { dataMode } = await import('../db/data-mode-schema')
      const { householdWriteOp } = await import('./data-mode')
      const { resolveDataMode } = await import('./data-mode-resolve')
      const { eq } = await import('drizzle-orm')
      const db = await getDb()

      const write = householdWriteOp(data.mode)
      if (write.op === 'delete') {
        // Inherit: drop the override row entirely.
        await db.delete(dataMode).where(eq(dataMode.scope, data.householdId))
      } else {
        const now = new Date()
        await db
          .insert(dataMode)
          .values({
            scope: data.householdId,
            mode: write.mode,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: dataMode.scope,
            set: { mode: write.mode, updatedAt: now },
          })
      }

      const effective = await resolveDataMode(db, data.householdId)
      return { householdId: data.householdId, override: data.mode, effective }
    },
  )
