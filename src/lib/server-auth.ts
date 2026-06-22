import { getRequest } from '@tanstack/react-start/server'
import { getAuth } from './auth'
import { setServerLogUser } from './log'

export interface SessionUser {
  id: string
  email: string
  name: string
}

/**
 * The synthetic user that local dev open-access signs you in as. Uses a
 * dedicated dev email (never a real address) so it can't collide with a real
 * `user.email` unique row. It is treated as an admin in dev by admin-server's
 * own dev override, so /admin opens too.
 */
export const DEV_USER: SessionUser = {
  id: 'dev-user',
  email: 'dev@souso.local',
  name: 'Dev (local)',
}

/** Read the real Better Auth session from the request cookies, if any. */
async function readRealSession(): Promise<SessionUser | undefined> {
  const request = getRequest()
  const auth = await getAuth()
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return undefined
  const u = session.user as { id: string; email: string; name?: string }
  return { id: u.id, email: u.email, name: u.name ?? u.email }
}

/**
 * #846: the raw `Cookie` header from the inbound request, or null. Lets the route
 * guard tell a GENUINE signed-out visitor (no session cookie) from a logged-in
 * user whose session resolution merely errored (cookie present). Never throws —
 * if `getRequest()` is unavailable the answer is "no cookie", which fails closed.
 */
export function getRequestCookieHeader(): string | null {
  try {
    return getRequest().headers.get('cookie')
  } catch {
    return null
  }
}

// Insert the dev user row at most once per isolate (insurance in case D1 ever
// enforces the household.ownerId -> user.id foreign key; today it does not).
let devUserEnsured = false
async function ensureDevUser(): Promise<void> {
  if (devUserEnsured) return
  devUserEnsured = true
  try {
    const { getDb } = await import('../db/client')
    const { user } = await import('../db/auth-schema')
    const now = new Date()
    await (
      await getDb()
    )
      .insert(user)
      .values({
        id: DEV_USER.id,
        name: DEV_USER.name,
        email: DEV_USER.email,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
  } catch {
    // dev-only best effort: never block dev sign-in on this write
  }
}

/**
 * Read the signed-in user from the request cookies on the server. Returns undefined
 * for signed-out requests in production, so a signed-out visitor never renders a
 * gated page (auth-guards canon).
 *
 * Local dev open-access: when running under `vite dev` (import.meta.env.DEV), a
 * request with no real session is treated as a dev admin (DEV_USER), so a fresh
 * clone runs with NO Better Auth / Resend / approved-emails setup, all routes
 * open. This branch is dead code in the deployed build (import.meta.env.DEV is
 * false after `vite build`), so souso.app stays fully gated. A real local session
 * still wins over the dev user.
 */
export async function getSessionUser(): Promise<SessionUser | undefined> {
  const user = await resolveSessionUser()
  // Attach the request's user to the server structured logger (#284) so every
  // server log line for this request carries { userId, email } and shows WHO
  // hit an error. `setServerLogUser(undefined)` clears it for signed-out paths;
  // it never throws, so it cannot break the request.
  setServerLogUser(user)
  return user
}

async function resolveSessionUser(): Promise<SessionUser | undefined> {
  if (import.meta.env.DEV) {
    try {
      const real = await readRealSession()
      if (real) return real
    } catch {
      // Better Auth not configured locally — fall through to the dev admin.
    }
    await ensureDevUser()
    return DEV_USER
  }
  return readRealSession()
}
