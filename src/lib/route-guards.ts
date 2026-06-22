import { createServerFn } from '@tanstack/react-start'
import { redirect, isRedirect } from '@tanstack/react-router'
import { log } from './log'

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
  /**
   * #846: whether the inbound request actually carried a Better Auth session
   * cookie. Distinguishes a GENUINE signed-out visitor (no cookie -> /sign-in is
   * correct) from a logged-in user whose session resolution hiccupped (cookie
   * present, resolution errored -> must NOT hard-bounce). Absent on the legacy
   * two-field shape, treated as `false` there for back-compat.
   */
  sessionCookiePresent?: boolean
  /**
   * #846: whether resolving the session threw (a transient server-side error,
   * e.g. a DB hiccup in getSessionUser) AFTER a retry, rather than a clean
   * "no user" result. Combined with `sessionCookiePresent` to decide whether a
   * null user is "definitely signed out" or "had a session but we couldn't read
   * it this tick".
   */
  resolutionErrored?: boolean
}

/** The name of the Better Auth session-token cookie (and its __Secure- prod variant). */
const SESSION_COOKIE_NAME = 'better-auth.session_token'

/**
 * #846: does the inbound request's Cookie header carry a Better Auth session
 * token? Pure + no-throw so it is unit-testable without the request chain. Matches
 * both the plain `better-auth.session_token` and the prod `__Secure-` prefixed
 * variant, anchored on a cookie-name boundary so an unrelated cookie whose value
 * merely contains the string can't false-match.
 */
export function requestHasSessionCookie(
  cookieHeader: string | null | undefined,
): boolean {
  if (!cookieHeader) return false
  // Cookie header is `name=value; name2=value2`. Split on `;`, trim, and check
  // the name before `=` matches the session token (with optional __Secure- /
  // __Host- prefix) exactly, so `not_a_session_token_field` can't match.
  return cookieHeader.split(';').some((pair) => {
    const name = pair.split('=')[0]?.trim() ?? ''
    return (
      name === SESSION_COOKIE_NAME ||
      name === `__Secure-${SESSION_COOKIE_NAME}` ||
      name === `__Host-${SESSION_COOKIE_NAME}`
    )
  })
}

/**
 * Pure redirect decision for the shared `_authed` guard (#251, #846). Keeps the
 * branch logic out of the async beforeLoad so it is unit-testable without the
 * server-fn/session chain. Mirrors the old per-route guards, with the #846
 * fail-closed refinement:
 *   - signed in + onboarded                      -> null (render the gated page)
 *   - signed in, no household                    -> '/onboarding'
 *   - null user, cookie present + resolution errored -> null (#846: DON'T bounce;
 *       render and let the client re-confirm — a logged-in user whose session
 *       merely failed to resolve this tick must not be treated as signed out)
 *   - null user, otherwise (no cookie, or clean signed-out) -> '/sign-in'
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
  if (!ctx?.user) {
    // #846 login-bounce: a NULL user is NOT automatically "signed out". If the
    // request carried a session cookie but resolution errored (a transient
    // server-side hiccup, even after a retry), bouncing to /sign-in would kick a
    // genuinely-logged-in user back to the login screen (the live bug). In that
    // one case, render the gated page and let the client re-confirm the session
    // (the cookie is still in the jar; a client getSession will resolve it). We
    // only suppress the bounce when BOTH a cookie was present AND resolution
    // errored. A clean null (no cookie, or no error) is a real signed-out
    // visitor and still goes to /sign-in, so a truly-signed-out person can never
    // reach a gated page. ctx is typed non-null but can be null at runtime
    // (#381), so keep the optional chain.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (ctx?.sessionCookiePresent && ctx.resolutionErrored) return null
    return '/sign-in'
  }
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
    const { getSessionUser, getRequestCookieHeader } =
      await import('./server-auth')

    // #846: capture whether the request even carried a session cookie BEFORE we
    // try to resolve it. A null user with NO cookie is a genuine signed-out
    // visitor; a null user WITH a cookie that we failed to resolve is the
    // login-bounce bug. This read never throws (fails closed to "no cookie").
    const sessionCookiePresent = requestHasSessionCookie(
      getRequestCookieHeader(),
    )

    // Resolve the session, retrying ONCE on a transient error (#846): the live
    // bounce was a one-off server-side hiccup right after sign-in. A single
    // retry absorbs the common case; if it still errors we mark
    // resolutionErrored so the guard can avoid hard-bouncing a cookie-carrying
    // (i.e. logged-in) user.
    let user: GuardUser | null = null
    let resolutionErrored = false
    try {
      user = (await getSessionUser()) ?? null
    } catch (firstErr) {
      // Logging must never throw into the request path (diagnose canon).
      try {
        log.warn('auth.guard.session_resolve_retry', {
          sessionCookiePresent,
          error:
            firstErr instanceof Error ? firstErr.message : String(firstErr),
        })
      } catch {
        /* swallow */
      }
      try {
        user = (await getSessionUser()) ?? null
      } catch (secondErr) {
        resolutionErrored = true
        try {
          log.error('auth.guard.session_resolve_failed', secondErr, {
            sessionCookiePresent,
          })
        } catch {
          /* swallow */
        }
      }
    }

    if (!user) {
      // #846 structured decision log: null user is either a real signed-out
      // visitor (no cookie / clean) or a transient resolution failure on a
      // logged-in user (cookie present + errored). Grep
      // `auth.guard.session_resolved` to see which on the next bounce report.
      try {
        log.info('auth.guard.session_resolved', {
          outcome:
            sessionCookiePresent && resolutionErrored
              ? 'unresolved_with_cookie'
              : 'signed_out',
          sessionCookiePresent,
          resolutionErrored,
        })
      } catch {
        /* swallow */
      }
      return {
        user: null,
        hasHousehold: false,
        sessionCookiePresent,
        resolutionErrored,
      }
    }

    try {
      log.info('auth.guard.session_resolved', {
        outcome: 'user',
        userId: user.id,
        sessionCookiePresent,
      })
    } catch {
      /* swallow */
    }

    const { getDb } = await import('../db/client')
    const { household } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    return {
      user,
      hasHousehold: rows.length > 0,
      sessionCookiePresent,
      resolutionErrored: false,
    }
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
    // The whole server fn failed (not just session resolution inside it) — we
    // have no cookie/error signal here, so fail closed to /sign-in. resolveAuthContext
    // now swallows session-resolution errors internally and returns flags, so this
    // branch is the rarer "server fn unreachable" case. Logged so it is greppable.
    try {
      log.error('auth.guard.context_unavailable', err)
    } catch {
      /* swallow */
    }
    throw redirect({ to: '/sign-in' })
  }
  const target = authedRedirectTarget(ctx)
  if (target) throw redirect({ to: target })
  // target === null means EITHER the user is present and onboarded, OR (#846) a
  // session cookie was present but resolution errored — in which case we render
  // the gated page and let the client re-confirm. `ctx.user` may be null in that
  // recovery path, so don't assert non-null; pass through what we have.
  return { user: ctx.user as GuardUser, hasHousehold: ctx.hasHousehold }
}
