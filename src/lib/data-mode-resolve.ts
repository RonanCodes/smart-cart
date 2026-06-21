import type { getDb } from '../db/client'
import { asDataMode, GLOBAL_SCOPE } from './data-mode'
import type { DataMode } from './data-mode'

/** The drizzle db handle, named so the helpers avoid an inline import type. */
type Db = Awaited<ReturnType<typeof getDb>>

/**
 * Server-only data-mode resolution. SPLIT OUT from data-mode-server deliberately:
 * this touches the DB, so it must never enter the client bundle. The admin
 * DataModePanel imports the createServerFns from data-mode-server (whose handlers
 * are stripped client-side) and the pure helpers from data-mode; it never imports
 * THIS module. The week + shopping loaders import here.
 *
 * The effective data mode for a household: its override row, else the global
 * default row, else 'real'. Pure D1 read (no auth, no network). Bad/legacy stored
 * values fall through to the next level rather than flipping to demo by mistake.
 */
export async function resolveDataMode(
  db: Db,
  householdId: string,
): Promise<DataMode> {
  const { dataMode } = await import('../db/data-mode-schema')
  const { inArray } = await import('drizzle-orm')
  const rows = await db
    .select({ scope: dataMode.scope, mode: dataMode.mode })
    .from(dataMode)
    .where(inArray(dataMode.scope, [householdId, GLOBAL_SCOPE]))

  const override = rows.find((r) => r.scope === householdId)
  const overrideMode = override ? asDataMode(override.mode) : null
  if (overrideMode) return overrideMode

  const global = rows.find((r) => r.scope === GLOBAL_SCOPE)
  const globalMode = global ? asDataMode(global.mode) : null
  if (globalMode) return globalMode

  return 'real'
}
