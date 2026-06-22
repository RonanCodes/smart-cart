import { createServerFn } from '@tanstack/react-start'

/**
 * Public stats for the marketing landing. These createServerFns are
 * intentionally UNGATED: the landing is what a signed-out visitor sees, so the
 * numbers it shows for social proof must be readable without a session.
 *
 * `getUserCount` returns the total registered-user count. The admin-only
 * `listUsers` in admin-server.ts is NOT reused here, since that one is gated and
 * returns per-user detail; this is a single public aggregate.
 */
export const getUserCount = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ count: number }> => {
    try {
      const { getDb } = await import('../db/client')
      const { user } = await import('../db/auth-schema')
      const { count } = await import('drizzle-orm')
      const db = await getDb()
      const total = (await db.select({ n: count() }).from(user))[0]?.n ?? 0
      return { count: total }
    } catch {
      // Social proof must never break the public page; degrade to 0 (hidden).
      return { count: 0 }
    }
  },
)
