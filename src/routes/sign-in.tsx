import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import { log } from '#/lib/log'
import { promptForNotifications } from '#/lib/push-client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

export const Route = createFileRoute('/sign-in')({ component: SignIn })

/** Reason codes for an OTP verify failure, mapped from Better Auth's error. */
type VerifyReason = 'expired' | 'rate_limited' | 'invalid' | 'unknown'

/**
 * Classify a Better Auth verify error into a reason. Better Auth surfaces a
 * `code`/`status` plus a human message; we key off both. A 403 / "too many
 * attempts" is rate-limiting, an expired/invalid OTP is the common case.
 */
function mapVerifyError(err: unknown): VerifyReason {
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
function verifyErrorMessage(reason: VerifyReason, err: unknown): string {
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

function SignIn() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: sendErr } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: 'sign-in',
    })
    setBusy(false)
    if (sendErr) return setError(sendErr.message ?? 'Could not send the code.')
    setStep('code')
  }

  async function resendCode() {
    setBusy(true)
    setError(null)
    const { error: sendErr } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: 'sign-in',
    })
    setBusy(false)
    if (sendErr) {
      log.error('auth.client_resend_failed', sendErr, {
        email,
        status: (sendErr as { status?: number }).status,
        origin: typeof window !== 'undefined' ? window.location.origin : null,
      })
      return setError(sendErr.message ?? 'Could not send a new code.')
    }
    setCode('')
    setError('Sent a fresh code. Check your email.')
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    // Digit-strip: iOS one-time-code autofill and the email's visual spacing can
    // turn "145284" into "1 4 5 2 8 4" or a trailing space, which fails Better
    // Auth's exact-match verify as "Invalid OTP". Send only the 6 digits.
    const otp = code.replace(/\D/g, '')
    setBusy(true)
    setError(null)
    const { error: signErr } = await authClient.signIn.emailOtp({
      email,
      otp,
    })
    setBusy(false)
    if (signErr) {
      const reason = mapVerifyError(signErr)
      log.error('auth.client_verify_failed', signErr, {
        email,
        status: (signErr as { status?: number }).status,
        code: (signErr as { code?: string }).code,
        reason,
        origin: typeof window !== 'undefined' ? window.location.origin : null,
      })
      return setError(verifyErrorMessage(reason, signErr))
    }
    // Fire the push opt-in inside this click-driven success handler so the
    // browser permission prompt counts as user-gesture-adjacent. Kicked off
    // before the redirect (fire-and-forget) so the prompt shows; navigation
    // never waits on it (#149 prompt-on-auth).
    void promptForNotifications()
    window.location.href = '/week'
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img
            src="/souso-mark.svg"
            alt="Souso"
            className="mb-2 h-auto w-full max-w-[140px] object-contain"
          />
          <CardTitle>Sign in to Souso</CardTitle>
          <CardDescription>
            {step === 'email'
              ? 'We email you a 6-digit code. No password.'
              : `Enter the code we sent to ${email}. Check your spam folder if you do not see it.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'email' ? (
            <form onSubmit={sendCode} className="space-y-3">
              <Input
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a code'}
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-3">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Checking…' : 'Sign in'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={resendCode}
                disabled={busy}
              >
                Resend code
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setStep('email')}
              >
                Use a different email
              </Button>
            </form>
          )}
          {error && <p className="text-destructive mt-3 text-sm">{error}</p>}
        </CardContent>
      </Card>
    </main>
  )
}
