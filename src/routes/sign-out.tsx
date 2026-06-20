import { createFileRoute } from '@tanstack/react-router'
import { getAuth } from '../lib/auth'
import { readSetCookies, buildSignOutRedirect } from '../lib/sign-out'

/**
 * Bulletproof server-side sign-out, reachable as a plain GET navigation at
 * /sign-out.
 *
 * Why this exists: the old client-only flow did `await authClient.signOut();
 * window.location.href = '/'`. On mobile that fetch can hang or throw (flaky
 * network, cookie quirks, an aborted PWA navigation), so the redirect after the
 * await never fired and the user stayed signed in. And if the cookie did not
 * clear, '/' just bounced back to /app.
 *
 * This route side-steps the client entirely. A hard navigation to /sign-out
 * runs Better Auth's sign-out ON THE SERVER for the current request: it deletes
 * the session row and emits the Set-Cookie that EXPIRES the session cookie. We
 * forward that Set-Cookie onto a 302 redirect to '/', so the browser lands on
 * '/' already cookie-cleared. The marketing Landing then renders (signed-out),
 * with no bounce back to /app. It works even when client JS is dead.
 *
 * Local dev open-access note: getSessionUser()'s import.meta.env.DEV branch
 * treats a no-session request as the DEV_USER, so after hitting /sign-out in
 * `vite dev` you are immediately "signed in" again as the dev admin. That is by
 * design (a fresh clone runs fully open). Real sign-out is therefore only
 * observable on the deployed build, where that branch is dead code.
 */
export const Route = createFileRoute('/sign-out')({
  server: {
    handlers: {
      GET: async ({ request }) => signOutAndRedirect(request),
      // POST too, so a form post (no-JS fallback) also works.
      POST: async ({ request }) => signOutAndRedirect(request),
    },
  },
})

/**
 * End the Better Auth session for this request and return a 302 to '/' that
 * carries the session-clearing Set-Cookie header(s).
 *
 * Better Auth's signOut deletes the session cookie regardless of whether a live
 * session was found (deleteSessionCookie always runs), so this clears state even
 * for an already-stale cookie. We never let a sign-out failure strand the user:
 * if the Better Auth call throws, we still redirect to '/'.
 */
async function signOutAndRedirect(request: Request): Promise<Response> {
  try {
    const auth = await getAuth()
    const res = await auth.api.signOut({
      headers: request.headers,
      asResponse: true,
    })
    // Forward the session-clearing Set-Cookie(s) Better Auth emitted onto our
    // redirect to '/', so the browser lands already cookie-cleared.
    return buildSignOutRedirect(readSetCookies(res))
  } catch (err) {
    // A sign-out failure must never strand the user on a gated page. Redirect
    // anyway; worst case the cookie outlives this request and they retry.
    console.error('server sign-out failed (redirecting anyway):', err)
    return buildSignOutRedirect([])
  }
}
