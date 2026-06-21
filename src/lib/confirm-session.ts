import { authClient } from '#/lib/auth-client'

/**
 * Confirm the session cookie is committed BEFORE a guarded navigation (#414).
 *
 * `authClient.signIn.emailOtp(...)` resolves as soon as the verify `fetch`
 * response body is read; the browser applies its `Set-Cookie` (the new session)
 * to the cookie jar asynchronously. If we synchronously hard-navigate to a
 * server-guarded route in the same tick, on iOS Safari the top-level navigation
 * request can be built BEFORE the cookie commits, so the SSR guard sees no
 * cookie and bounces the user back to /sign-in.
 *
 * The fix is to re-read the session client-side and only resolve once
 * `getSession()` returns a user — that read goes through the same cookie jar the
 * navigation will use, so a positive result guarantees the cookie is readable.
 * We poll briefly (the cookie commit is near-instant) and give up after a small
 * timeout so a genuinely broken session never hangs the UI: the caller then
 * navigates anyway and the guard makes the final call.
 *
 * Never throws — a getSession error is treated as "not yet" and retried.
 */
export async function confirmSession(opts?: {
  /** Total time to wait for the cookie before giving up. Default 3000ms. */
  timeoutMs?: number
  /** Delay between polls. Default 100ms. */
  intervalMs?: number
}): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 3000
  const intervalMs = opts?.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs

  // First attempt with no delay: desktop/Chrome usually commit the cookie before
  // the verify promise even resolves, so the common case returns immediately.
  for (;;) {
    let hasUser = false
    try {
      const res = await authClient.getSession()
      hasUser = Boolean(res.data?.user)
    } catch {
      // Treat a transient getSession failure as "not yet" and keep polling.
      hasUser = false
    }
    if (hasUser) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
