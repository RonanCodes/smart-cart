import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP, magicLink } from 'better-auth/plugins'
import { getDb } from '../db/client'
import * as schema from '../db/auth-schema'
import { readEnv } from './env'
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
async function buildAuth() {
  const db = await getDb()
  const secret = await readEnv('BETTER_AUTH_SECRET')
  const baseURL = (await readEnv('BETTER_AUTH_URL')) ?? 'http://localhost:3000'
  return betterAuth({
    secret,
    baseURL,
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
            // Make the "you're on the waitlist" message TRUE: idempotently add
            // the email so an admin sees them at /admin/waitlist. Best-effort,
            // already swallows its own errors, so the gate still throws below.
            const { addUnapprovedEmailToWaitlist } =
              await import('./waitlist-gate')
            await addUnapprovedEmailToWaitlist(email)
            throw new Error(NOT_APPROVED_MESSAGE)
          }
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
            console.error('OTP magic-link send failed, falling back:', err)
            try {
              await sendOtpEmail(email, otp)
            } catch (fallbackErr) {
              console.error(
                'sendOtpEmail fallback failed (continuing):',
                fallbackErr,
              )
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
