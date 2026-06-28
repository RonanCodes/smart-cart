import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP, magicLink } from 'better-auth/plugins'
import { getDb } from '../db/client'
import * as schema from '../db/auth-schema'
import { readEnv } from './env'
import { log } from './log'
import { sendApprovalEmail, sendOtpEmail } from './email'
import {
  NEW_USER_DESTINATION,
  ONBOARDED_DESTINATION,
  readMagicLinkMetadata,
} from './magic-link'

/**
 * Better Auth is built lazily (async) because the DB handle and secrets are only
 * resolvable per-request inside the Worker. Sign-in is passwordless email OTP via
 * Resend, no Google Cloud / OAuth setup needed, fastest login to ship for the demo.
 */
/**
 * The origins Better Auth will accept a sign-in request from. Always includes the
 * configured `baseURL`, the production custom domain, the Worker's `*.workers.dev`
 * URL, and localhost (dev). A comma-separated `TRUSTED_ORIGINS` env can add more
 * (e.g. a preview deploy) without a code change. Better Auth supports `*` wildcard
 * patterns. De-duped and blank-stripped. Pure so it is easy to reason about.
 */
export function resolveTrustedOrigins(
  baseURL: string,
  extraEnv: string | undefined | null,
): Array<string> {
  const extra = (extraEnv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return Array.from(
    new Set(
      [
        baseURL,
        // The app is served on all of these custom domains; a sign-in from any
        // of them must be trusted or Better Auth rejects it with "Invalid origin".
        'https://souso.app',
        'https://www.souso.app',
        'https://smartcart.ronanconnolly.dev',
        'https://*.workers.dev',
        'http://localhost:3000',
        'http://localhost:5173',
        ...extra,
      ].filter(Boolean),
    ),
  )
}

/**
 * Map a Better Auth OTP-verify error message to a greppable reason code for the
 * server logs. Better Auth does not log OTP verify failures itself, so this is
 * the only signal we get for "why did sign-in fail". Pure + no-throw.
 */
export function mapOtpVerifyReason(message: string | undefined | null): string {
  const msg = (message ?? '').toLowerCase()
  if (msg.includes('expired')) return 'expired'
  if (msg.includes('too many')) return 'rate_limited'
  if (msg.includes('not found') || msg.includes('user not found'))
    return 'no_user'
  if (msg.includes('invalid') || msg.includes('incorrect')) return 'invalid'
  return 'unknown'
}

/** True for the email-OTP sign-in verify endpoint, whatever leading slash. */
function isOtpVerifyPath(path: string | undefined | null): boolean {
  return typeof path === 'string' && path.includes('/sign-in/email-otp')
}

async function buildAuth() {
  const db = await getDb()
  const secret = await readEnv('BETTER_AUTH_SECRET')
  const baseURL = (await readEnv('BETTER_AUTH_URL')) ?? 'http://localhost:3000'
  const trustedOrigins = resolveTrustedOrigins(
    baseURL,
    await readEnv('TRUSTED_ORIGINS'),
  )
  log.info('auth.build', { baseURL, trustedOrigins })
  if (!secret) {
    // A missing secret breaks sign-in entirely; surface it loudly (never log the
    // value, just its absence) so a misconfigured deploy is obvious in the logs.
    log.error('auth.secret_missing', undefined, { baseURL })
  }
  return betterAuth({
    secret,
    baseURL,
    // Better Auth rejects any sign-in whose Origin header is not the baseURL or
    // listed here ("Invalid origin"). The app is reachable via the custom domain,
    // the *.workers.dev URL, and localhost in dev, so all are trusted; extra
    // hosts (previews) can be added via the TRUSTED_ORIGINS env with no redeploy.
    trustedOrigins,
    // Keep people signed in for a month, refreshed on activity, instead of being
    // bounced to sign-in (reported daily re-logins). Better Auth's defaults are a
    // 7-day session refreshed at most once a day; we set an explicit long, ROLLING
    // window — expiresIn is the max lifetime AND the session-cookie max-age (so the
    // cookie persists across browser/PWA restarts rather than dying with the
    // session), and updateAge re-extends it on activity so an active user never
    // hits the wall.
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // extend daily on activity (rolling window)
    },
    advanced: {
      useSecureCookies: baseURL.startsWith('https://'),
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: baseURL.startsWith('https://'),
      },
    },
    // Better Auth does not log OTP verify failures itself; this is the only
    // server-side signal for "why did sign-in fail". onAPIError.onError fires on
    // every failed endpoint — we narrow to the email-OTP verify path and emit a
    // reason-coded warn. We do NOT set `throw`, so error-throwing behaviour is
    // unchanged. Wrapped so observability can never break the request.
    onAPIError: {
      onError: (error, ctx) => {
        try {
          // `ctx` is typed as the broad AuthContext; at runtime the error-time
          // context carries the request `path` + `body`. Read them defensively.
          const rc = ctx as unknown as { path?: string; body?: unknown }
          if (!isOtpVerifyPath(rc.path)) return
          const e = error as { message?: string; status?: number }
          const email =
            typeof rc.body === 'object' && rc.body !== null
              ? (rc.body as { email?: string }).email
              : undefined
          log.warn('auth.otp_verify_failed', {
            email,
            status: e.status,
            reason: mapOtpVerifyReason(e.message),
          })
        } catch {
          // Observability must never crash the request (diagnose canon).
        }
      },
    },
    hooks: {
      // On a SUCCESSFUL OTP verify, emit a matching ok event so the logs show
      // both sides of the funnel. The `after` hook runs post-handler; a failed
      // verify throws before returning, so reaching here on this path = success.
      after: createAuthMiddleware(async (ctx) => {
        try {
          if (isOtpVerifyPath(ctx.path)) {
            const email = (ctx.body as { email?: string } | undefined)?.email
            log.info('auth.otp_verify_ok', { email })
          }
        } catch {
          // Never let logging break the request.
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Fires when a brand-new account row is created — SYNCHRONOUSLY, and
          // crucially BEFORE the client round-trips to completeOnboarding. It has
          // no attribution ("How did you find us?"), so it must NOT send the
          // admin new-signup notice: if it did, it would win the claim-once row
          // and suppress the attributed send from completeOnboarding, leaving
          // admins with "Source: not provided" for every onboarding signup
          // (#521). We pass `fromHook: true` so this call is a non-pre-empting
          // no-op; completeOnboarding is the authoritative sender of the single
          // attributed admin email. (A brand-new account is always created via
          // the onboarding email step, so completeOnboarding always runs.)
          after: async (newUser) => {
            try {
              if (newUser.email) {
                const { notifyAdminsOfNewUser } =
                  await import('./waitlist-notify')
                await notifyAdminsOfNewUser({
                  email: newUser.email,
                  userId: newUser.id,
                  fromHook: true,
                })
              }
            } catch {
              // Non-fatal: a notification failure must never break sign-up.
            }
          },
        },
      },
    },
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    // Passwordless: no password to manage. Sign-in is a 6-digit code by email.
    emailAndPassword: { enabled: false },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600, // 10 minutes
        // Open sign-up: a first-time email creates the account on verify.
        sendVerificationOnSignUp: true,
        async sendVerificationOTP({ email, otp }) {
          // Gated access: only approved emails (or the admin) may sign in.
          // Reject BEFORE sending a code so a waitlisted email can never
          // complete sign-in.
          const { isApproved, NOT_APPROVED_MESSAGE } = await import('./access')
          if (!(await isApproved(email))) {
            log.warn('auth.otp_gated', { email })
            // Make the "you're on the waitlist" message TRUE: idempotently add
            // the email so an admin sees them at /admin/waitlist. Best-effort,
            // already swallows its own errors, so the gate still throws below.
            const { addUnapprovedEmailToWaitlist } =
              await import('./waitlist-gate')
            await addUnapprovedEmailToWaitlist(email)
            throw new Error(NOT_APPROVED_MESSAGE)
          }
          log.info('auth.otp_send_start', { email })
          // Issue #259: send the OTP email WITH a one-tap magic sign-in link
          // below the code. signInMagicLink generates a single-use, short-TTL
          // token (existing `verification` table) and fires `sendMagicLink`,
          // which builds the combined code + link email. The typed code stays
          // the fallback: if link generation fails we send the plain-code email.
          // Non-fatal throughout: a Resend / link outage must not throw out of
          // the sign-in endpoint.
          try {
            const auth = await getAuth()
            // The email is already approved here (gated above), so the magic
            // link can safely sign them in. callbackURL/newUserCallbackURL set
            // where they land after verifying (onboarded -> /week, else
            // /onboarding). metadata.flow tells sendMagicLink to render the
            // OTP-supplement body and carry the code into it.
            await auth.api.signInMagicLink({
              // The endpoint requires headers; we have no inbound request here
              // (we are inside the OTP send hook), so an empty set is fine, the
              // link is bound to the email, not the requesting session.
              headers: new Headers(),
              body: {
                email,
                callbackURL: ONBOARDED_DESTINATION,
                newUserCallbackURL: NEW_USER_DESTINATION,
                metadata: { flow: 'otp', otp },
              },
            })
          } catch (err) {
            log.warn('auth.otp_magiclink_failed', { email })
            log.error('auth.otp_magiclink_error', err, { email })
            try {
              await sendOtpEmail(email, otp)
              log.info('auth.otp_fallback_sent', { email })
            } catch (fallbackErr) {
              log.error('auth.otp_fallback_failed', fallbackErr, { email })
            }
          }
        },
      }),
      // Issue #259: shared one-tap magic sign-in link, single-use + short TTL
      // (10 min, matching the OTP). ONE callback serves both transactional
      // emails; it dispatches on metadata.flow. The plugin reuses the existing
      // `verification` table, so no new migration. The token is NEVER logged.
      magicLink({
        expiresIn: 600,
        async sendMagicLink({ email, url, metadata }) {
          // Same gate as the OTP flow: only approved emails (or the admin) may
          // receive a working sign-in link. This closes the hole where the
          // client `/sign-in/magic-link` endpoint could otherwise request a
          // link for any address and bypass the waitlist. Our internal callers
          // (OTP flow + approval flow) always pass an approved email, so this is
          // only load-bearing for externally-triggered requests.
          const { isApproved, NOT_APPROVED_MESSAGE } = await import('./access')
          if (!(await isApproved(email))) {
            const { addUnapprovedEmailToWaitlist } =
              await import('./waitlist-gate')
            await addUnapprovedEmailToWaitlist(email)
            throw new Error(NOT_APPROVED_MESSAGE)
          }
          const { flow, otp } = readMagicLinkMetadata(metadata)
          if (flow === 'otp') {
            // The OTP email shows the code (fallback) AND this one-tap link.
            // `otp` is carried through metadata so we don't re-stash here.
            await sendOtpEmail(email, otp ?? '', url)
            return
          }
          // Approval flow: a welcome email with a single sign-in button.
          await sendApprovalEmail(email, url)
        },
      }),
    ],
  })
}

let cached: Awaited<ReturnType<typeof buildAuth>> | undefined

export async function getAuth() {
  if (!cached) cached = await buildAuth()
  return cached
}

/**
 * Issue #259: generate and email a one-tap approval sign-in link to a freshly
 * approved waitlist email. Best-effort by contract: the access grant has already
 * been written by the time admin-server calls this, so a Resend / link failure
 * must NEVER throw out of the approve action. The token is single-use, short-TTL,
 * and never logged. Lands the user on /onboarding (new) or /week (already
 * onboarded) after they tap.
 *
 * Returns `{ sent }` so the caller can log the outcome without inspecting the
 * link internals. Swallows its own errors (logged, not rethrown).
 */
export async function sendApprovalMagicLink(
  email: string,
): Promise<{ sent: boolean }> {
  try {
    const auth = await getAuth()
    await auth.api.signInMagicLink({
      // No inbound request in the approve action; the link is bound to the
      // email so an empty header set is fine.
      headers: new Headers(),
      body: {
        email,
        callbackURL: ONBOARDED_DESTINATION,
        newUserCallbackURL: NEW_USER_DESTINATION,
        metadata: { flow: 'approval' },
      },
    })
    return { sent: true }
  } catch (err) {
    // Never log the token; only the failure. Approval already committed.
    console.error('sendApprovalMagicLink failed (continuing):', err)
    return { sent: false }
  }
}
