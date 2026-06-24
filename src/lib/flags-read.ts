import { FLAG_DEFAULTS, mergeFlags } from './flags'
import type { FlagSet } from './flags'

/**
 * Server-only feature-flag read. Lives in its own module (NOT flags-server.ts)
 * so it is only ever reached via a dynamic `import()` inside a server-fn handler
 * — the same discipline as launch.ts `readLaunchState` and the getStore handler.
 * That keeps its transitive `db/client` (which imports `cloudflare:workers`) out
 * of the CLIENT bundle: a plain export sitting next to the createServerFns would
 * be dragged into the client graph by `__root`'s static `getFlags` import and
 * break the client build.
 *
 * Reads one row per flag key from D1; missing keys fall back to FLAG_DEFAULTS via
 * mergeFlags. Degrades to the full defaults on ANY error (e.g. the migration not
 * yet applied), so a missing table / failed read never throws out of a request
 * path and never opens a feature.
 */
export async function readFlags(): Promise<FlagSet> {
  try {
    const { getDb } = await import('../db/client')
    const { featureFlag } = await import('../db/feature-flag-schema')
    const db = await getDb()
    const rows = await db
      .select({ key: featureFlag.key, enabled: featureFlag.enabled })
      .from(featureFlag)
    const partial: Record<string, boolean> = {}
    for (const r of rows) partial[r.key] = Boolean(r.enabled)
    return mergeFlags(partial)
  } catch {
    return { ...FLAG_DEFAULTS }
  }
}
