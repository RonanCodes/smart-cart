import { drizzle } from 'drizzle-orm/d1'
import { sql } from 'drizzle-orm'
import * as schema from './schema'

/**
 * Cloudflare D1 (SQLite). The binding `DB` is declared in wrangler.jsonc and exposed
 * on the Worker env (and in vite dev via the Cloudflare plugin's local D1). We read
 * it from `cloudflare:workers` env at call time rather than caching across requests.
 */
async function getD1(): Promise<D1Database> {
  const { env } = await import('cloudflare:workers')
  const db = (env as { DB?: D1Database }).DB
  if (!db) {
    throw new Error(
      'D1 binding `DB` not found. Check the d1_databases binding in wrangler.jsonc.',
    )
  }
  return db
}

export async function getDb() {
  return drizzle(await getD1(), { schema })
}

export type DbHealth =
  | { connected: true }
  | { connected: false; reason: 'unconfigured' | 'error'; detail?: string }

/** Health probe. Never throws, observability must not crash a request. */
export async function checkDbHealth(): Promise<DbHealth> {
  try {
    const db = await getDb()
    await db.run(sql`select 1`)
    return { connected: true }
  } catch (err) {
    return {
      connected: false,
      reason: 'error',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
