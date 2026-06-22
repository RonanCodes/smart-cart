/**
 * SERVER-ONLY: tell the live-count Durable Object the new registered-user total
 * after a signup, so every open landing page ticks up without a refresh.
 *
 * This module reaches the COUNTER_DO BINDING via the `cloudflare:workers` env
 * import (a binding, not a string var, so readEnv from env.ts is not the right
 * tool here). It is only ever called from the Better Auth
 * databaseHooks.user.create.after hook, which itself is server-only; the dynamic
 * imports keep `cloudflare:workers` and the DB out of the client graph.
 *
 * Best-effort by contract: every error is swallowed. A counter that is briefly
 * stale (or a missing binding in a dev env) must NEVER break sign-up. The DO's
 * count is monotonic, so a racing/late POST cannot make the number go down.
 */
import { serializeCount } from './counter-core'

const LIVE_COUNT_DO_NAME = 'global'

/** Minimal shape of the env binding we touch. */
interface CounterEnv {
  COUNTER_DO?: {
    idFromName: (name: string) => unknown
    get: (id: unknown) => { fetch: (req: Request) => Promise<Response> }
  }
}

/**
 * Compute the current real `user`-table total and POST it to the global
 * CounterDO. Same count source as the admin notifier (the `user` table), so the
 * live number matches the SSR `getUserCount`.
 */
export async function bumpLiveCount(): Promise<void> {
  try {
    const { env } = (await import('cloudflare:workers')) as {
      env: CounterEnv
    }
    const ns = env.COUNTER_DO
    if (!ns) return // dev / missing binding: nothing to do, no throw

    const { getDb } = await import('../../db/client')
    const { user } = await import('../../db/auth-schema')
    const { count } = await import('drizzle-orm')
    const db = await getDb()
    const total = (await db.select({ n: count() }).from(user))[0]?.n ?? 0

    const id = ns.idFromName(LIVE_COUNT_DO_NAME)
    await ns.get(id).fetch(
      new Request('https://do/bump', {
        method: 'POST',
        body: serializeCount(total),
      }),
    )
  } catch {
    // Never break sign-up over a counter update.
  }
}
