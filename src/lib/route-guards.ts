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
 * visitor should skip straight to /app, while still letting signed-out visitors
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
 *   - signed-in + onboarded  -> redirect to /app
 *   - signed-in + NOT onboarded -> redirect to /onboarding (the Jow form)
 *   - signed out             -> stay (render the marketing Landing)
 * Returns the redirect target, or null to render the Landing in place.
 */
export function entryRedirectTarget(input: {
  signedIn: boolean
  onboarded: boolean
}): '/app' | '/onboarding' | null {
  if (!input.signedIn) return null
  return input.onboarded ? '/app' : '/onboarding'
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
