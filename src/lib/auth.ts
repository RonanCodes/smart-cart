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
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    // Passwordless: no password to manage. Sign-in is a 6-digit code by email.
    emailAndPassword: { enabled: false },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600, // 10 minutes
        // Open sign-up: a first-time email creates the account on verify.
        sendVerificationOnSignUp: true,
        async sendVerificationOTP({ email, otp }) {
          await sendOtpEmail(email, otp)
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
