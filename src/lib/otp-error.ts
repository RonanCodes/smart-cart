/**
 * Pure (no server imports) OTP verify-error classification, shared by the three
 * sign-in surfaces: `/sign-in`, the `/login` LoginForm, and onboarding's
 * email-step. Kept dependency-free so it is safe to import from client
 * components — it must NEVER pull in `auth.ts` / `db/client` (those touch
 * `cloudflare:workers` and would break the client build).
 *
 * The load-bearing distinction (#387): a WRONG / expired / rate-limited OTP is
 * EXPECTED user behaviour — a handled 4xx — not an application error. It must be
 * shown inline and logged as a breadcrumb (`log.warn`), never as a Sentry
 * exception (`log.error`, which materialises into `captureException`). Only a
 * genuine unexpected / 5xx failure is a real error and stays a Sentry exception.
 */

/** Reason codes for an OTP verify failure, mapped from Better Auth's error. */
export type VerifyReason = 'expired' | 'rate_limited' | 'invalid' | 'unknown'

/**
 * Classify a Better Auth verify error into a reason. Better Auth surfaces a
 * `code`/`status` plus a human message; we key off both. A 403 / "too many
 * attempts" is rate-limiting, an expired/invalid OTP is the common case.
 */
export function mapVerifyError(err: unknown): VerifyReason {
  const e = err as { code?: string; status?: number; message?: string }
  const msg = (e.message ?? '').toLowerCase()
  if (e.code === 'OTP_EXPIRED' || msg.includes('expired')) return 'expired'
  if (e.status === 403 || msg.includes('too many')) return 'rate_limited'
  if (
    e.code === 'INVALID_OTP' ||
    msg.includes('invalid') ||
    msg.includes('incorrect')
  )
    return 'invalid'
  return 'unknown'
}

/** User-facing copy for each verify reason. Falls back to the raw message. */
export function verifyErrorMessage(reason: VerifyReason, err: unknown): string {
  switch (reason) {
    case 'expired':
      return 'That code expired. Tap resend to get a new one.'
    case 'rate_limited':
      return 'Too many tries. Request a fresh code and try again.'
    case 'invalid':
      return "That code isn't right. Re-enter the 6 digits (no spaces)."
    default:
      return (err as { message?: string }).message ?? 'That code did not work.'
  }
}

/**
 * Is this verify failure an EXPECTED 4xx OTP outcome (wrong / expired /
 * rate-limited)? Those are normal user behaviour: surface inline + log a
 * breadcrumb, never a Sentry exception.
 *
 * A failure is expected when EITHER the mapped reason is a known 4xx case
 * (invalid / expired / rate_limited) OR the HTTP status is a 4xx (a client
 * error Better Auth returned). Anything else — `unknown` reason with a 5xx /
 * missing status, e.g. a network blip, a Worker crash, an origin rejection — is
 * a genuine error and stays a Sentry exception.
 */
export function isExpectedOtpError(err: unknown): boolean {
  const status = (err as { status?: number }).status
  if (typeof status === 'number' && status >= 500) return false
  if (typeof status === 'number' && status >= 400 && status < 500) return true
  return mapVerifyError(err) !== 'unknown'
}
