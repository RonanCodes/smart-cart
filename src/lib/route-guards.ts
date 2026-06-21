import { createServerFn } from '@tanstack/react-start'
import { redirect, isRedirect } from '@tanstack/react-router'

export interface GuardUser {
  id: string
  email: string
  name: string
}

/**
 * Resolve the signed-in user from the request cookie. Server-only: the auth import
 * is dynamic and inside the handler, so its `cloudflare:workers` / getRequest chain
 * is stripped from the client bundle, only this call site is statically reachable
 * from client routes.
 */
const resolveSessionUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GuardUser | null> => {
    const { getSessionUser } = await import('./server-auth')
    return (await getSessionUser()) ?? null
  },
)

/**
 * Resolve the signed-in user, or null when signed out, without redirecting.
 * Used by the public opener (index route) to decide whether an already-onboarded
 * visitor should skip straight to /week, while still letting signed-out visitors
 * through to swipe anonymously. Fails open to null so a transient session error
 * never blocks the public deck.
 */
export async function resolveSessionUserOrNull(): Promise<GuardUser | null> {
  try {
    return await resolveSessionUser()
  } catch {
    return null
  }
}

/**
 * Pure entry-routing decision for `/`. Keeps the branch logic out of the route's
 * async beforeLoad so it can be unit-tested without the server-fn/session chain:
 *   - signed-in + onboarded  -> redirect to /week (auto-plans + shows recipes)
 *   - signed-in + NOT onboarded -> redirect to /onboarding (the Jow form)
 *   - signed out             -> stay (render the marketing Landing)
 * Returns the redirect target, or null to render the Landing in place.
 */
export function entryRedirectTarget(input: {
  signedIn: boolean
  onboarded: boolean
}): '/week' | '/onboarding' | null {
  if (!input.signedIn) return null
  return input.onboarded ? '/week' : '/onboarding'
}

/**
 * `beforeLoad` guard for signed-in-only routes. A signed-out visitor is redirected
 * to /sign-in server-side before any gated page renders. Fails closed: any error
 * resolving the session redirects to sign-in rather than leaking the gated page.
 */
export async function requireUserBeforeLoad(): Promise<{ user: GuardUser }> {
  let user: GuardUser | null
  try {
    user = await resolveSessionUser()
  } catch (err) {
    if (isRedirect(err)) throw err
    throw redirect({ to: '/sign-in' })
  }
  if (!user) throw redirect({ to: '/sign-in' })
  return { user }
}

/** The session + onboarding state every gated route needs, resolved together. */
export interface AuthContext {
  user: GuardUser | null
  hasHousehold: boolean
}

/**
 * Pure redirect decision for the shared `_authed` guard (#251). Keeps the branch
 * logic out of the async beforeLoad so it is unit-testable without the
 * server-fn/session chain. Mirrors the old per-route guards exactly:
 *   - signed out             -> '/sign-in'
 *   - signed in, no household -> '/onboarding'
 *   - signed in + onboarded   -> null (render the gated page)
 */
export function authedRedirectTarget(
  ctx: AuthContext,
): '/sign-in' | '/onboarding' | null {
  // Fail closed if the whole context is missing (#381): a prod 500 made
  // `resolveAuthContext` resolve to `undefined`, and reading `.user` off it
  // crashed `/week` with `e.user` in the error boundary. The type says `ctx` is
  // always present, but the runtime proved otherwise, so guard it (the rule
  // can't see the prod-500 state). Treat a nullish context like a signed-out
  // visitor.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!ctx?.user) return '/sign-in'
  if (!ctx.hasHousehold) return '/onboarding'
  return null
}

/**
 * Resolve session + onboarding state in ONE round-trip (#251). Each gated route
 * used to call resolveSessionUser + hasHousehold separately in its own beforeLoad,
 * so /week, /shopping, /app each fired two guard server-fns per visit. This is the
 * single server fn the shared `_authed` layout calls once; children read the
 * resolved `{ user, hasHousehold }` off route context instead of re-fetching.
 *
 * Server-only: the auth + db imports are dynamic and inside the handler, so the
 * `cloudflare:workers` / getRequest chain is stripped from the client bundle.
 * Returns `user: null` (rather than throwing) when signed out, so the layout's
 * beforeLoad owns the redirect decision in one place.
 */
export const resolveAuthContext = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthContext> => {
    const { getSessionUser } = await import('./server-auth')
    const user = (await getSessionUser()) ?? null
    if (!user) return { user: null, hasHousehold: false }

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    return { user, hasHousehold: rows.length > 0 }
  },
)

/**
 * `beforeLoad` guard for the shared `_authed` layout (#251). Resolves auth +
 * onboarding once and returns `{ user, hasHousehold }` for child routes to read
 * off context, replacing the per-route `requireUserBeforeLoad()` + `hasHousehold()`
 * pair. Behaviour is identical to the old per-route guards:
 *   - signed out          -> redirect to /sign-in (fails closed on any error)
 *   - signed in, no household -> redirect to /onboarding
 *   - signed in + onboarded   -> pass `{ user, hasHousehold: true }` to children
 */
export async function requireAuthedBeforeLoad(): Promise<{
  user: GuardUser
  hasHousehold: boolean
}> {
  let ctx: AuthContext
  try {
    ctx = await resolveAuthContext()
  } catch (err) {
    if (isRedirect(err)) throw err
    throw redirect({ to: '/sign-in' })
  }
  const target = authedRedirectTarget(ctx)
  if (target) throw redirect({ to: target })
  // target === null means user is present and onboarded.
  return { user: ctx.user!, hasHousehold: ctx.hasHousehold }
}
