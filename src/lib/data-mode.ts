/**
 * Pure data-mode helpers + types. NO DB, NO env, NO server imports, so this is
 * import-safe from the client bundle (the admin DataModePanel) AND the server.
 * The DB-touching resolver lives in data-mode-resolve.ts and the admin
 * createServerFns in data-mode-server.ts.
 *
 * Mode precedence (implemented in the resolver): a household's override row ??
 * the global default row ?? 'real'. 'real' is the safe default (the app shows
 * the household's actual data); every write is strictly validated to
 * 'real' | 'demo'.
 */

/** The two valid data modes. 'real' is the safe default everywhere. */
export type DataMode = 'real' | 'demo'

/** The scope key for the app-wide default row. */
export const GLOBAL_SCOPE = 'global'

/** Narrow an arbitrary value to a DataMode, or null if it is neither. */
export function asDataMode(value: unknown): DataMode | null {
  return value === 'real' || value === 'demo' ? value : null
}

/** Strictly parse a mode for a write, throwing on anything but 'real'|'demo'. */
export function requireDataMode(value: unknown): DataMode {
  const m = asDataMode(value)
  if (!m) throw new Error(`Invalid data mode "${String(value)}"`)
  return m
}

/**
 * Decide what a per-household write does, purely from the requested mode. A null
 * mode means "inherit" -> delete the override row; a valid mode -> upsert it.
 * Extracted so the delete-vs-upsert decision is unit-testable without auth/DB.
 */
export function householdWriteOp(
  mode: DataMode | null,
): { op: 'delete' } | { op: 'upsert'; mode: DataMode } {
  return mode === null ? { op: 'delete' } : { op: 'upsert', mode }
}
