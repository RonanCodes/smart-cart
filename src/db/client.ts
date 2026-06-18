import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { sql } from 'drizzle-orm'
import { readEnv } from '../lib/env'
import * as schema from './schema'

/**
 * Module-level neon client cache. The neon-http driver is stateless (each query is
 * an independent HTTPS fetch), so sharing the drizzle instance across concurrent
 * requests within a Worker isolate is safe and avoids re-constructing the client.
 */
let cachedUrl: string | undefined
let cachedDb: ReturnType<typeof drizzle<typeof schema>> | undefined

export async function getDb() {
  const url = await readEnv('NEON_DATABASE_URL')
  if (!url) {
    throw new Error(
      'NEON_DATABASE_URL is not set. Add it to .dev.vars for local dev or as a wrangler secret in production.',
    )
  }
  if (cachedUrl === url && cachedDb) return cachedDb
  cachedDb = drizzle(neon(url), { schema })
  cachedUrl = url
  return cachedDb
}

export type DbHealth =
  | { connected: true }
  | { connected: false; reason: 'unconfigured' | 'error'; detail?: string }

/** Health probe. Never throws, observability must not crash a request. */
export async function checkDbHealth(): Promise<DbHealth> {
  let url: string | undefined
  try {
    url = await readEnv('NEON_DATABASE_URL')
  } catch {
    return { connected: false, reason: 'error' }
  }
  if (!url) return { connected: false, reason: 'unconfigured' }
  try {
    const db = await getDb()
    await db.execute(sql`select 1`)
    return { connected: true }
  } catch (err) {
    return {
      connected: false,
      reason: 'error',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
