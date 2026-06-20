import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP } from 'better-auth/plugins'
import { getDb } from '../db/client'
import * as schema from '../db/auth-schema'
import { readEnv } from './env'
import { sendOtpEmail } from './email'

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
          // Reject BEFORE stashing or sending a code so a waitlisted email can
          // never complete sign-in via the normal flow or the demo skip path.
          const { isApproved, NOT_APPROVED_MESSAGE } = await import('./access')
          if (!(await isApproved(email))) {
            throw new Error(NOT_APPROVED_MESSAGE)
          }
          // Stash first so the demo skip-login path can read it back even if the
          // email never goes out (Resend outage). See stashOtp/consumeOtp below.
          stashOtp(email, otp)
          // Non-fatal: a Resend outage must not throw out of the sign-in endpoint.
          try {
            await sendOtpEmail(email, otp)
          } catch (err) {
            console.error('sendOtpEmail failed (continuing):', err)
          }
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
 * DEMO SKIP-LOGIN support (Resend outage workaround).
 *
 * Better Auth hands us the plaintext OTP in `sendVerificationOTP`. We stash the most
 * recent one per email so a server fn can read it back WITHIN THE SAME REQUEST (same
 * Worker isolate) and complete sign-in without the email being delivered. The only
 * consumer is `demo-auth.ts`. Remove this and the skip button after the demo. The
 * normal email-OTP flow is unaffected.
 */
const lastOtpByEmail = new Map<string, string>()

export function stashOtp(email: string, otp: string): void {
  lastOtpByEmail.set(email.toLowerCase(), otp)
}

export function consumeOtp(email: string): string | undefined {
  const key = email.toLowerCase()
  const otp = lastOtpByEmail.get(key)
  lastOtpByEmail.delete(key)
  return otp
}
