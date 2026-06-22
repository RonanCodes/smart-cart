import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import { log } from '#/lib/log'
import {
  mapVerifyError,
  verifyErrorMessage,
  isExpectedOtpError,
} from '#/lib/otp-error'
import { promptForNotifications } from '#/lib/push-client'
import { confirmSession } from '#/lib/confirm-session'
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

// Exported for the verify()/navigation-ordering tests (#414). The route uses it
// as `component: SignIn`; tests render it directly (it uses window.location, not
// router hooks, so it stands alone).
export function SignIn() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // Capture the email the user entered on EVERY request (not just failures),
    // so an OTP issue (e.g. Android autofill) is traceable by email + device.
    log.info('auth.otp_requested', {
      email,
      origin: typeof window !== 'undefined' ? window.location.origin : null,
      userAgent:
        typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    })
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
      const detail = {
        email,
        status: (signErr as { status?: number }).status,
        code: (signErr as { code?: string }).code,
        reason,
        origin: typeof window !== 'undefined' ? window.location.origin : null,
      }
      // #387: a wrong / expired / rate-limited OTP is EXPECTED (a handled 4xx);
      // log a warn breadcrumb, not a Sentry exception. Only an unexpected / 5xx
      // failure stays log.error -> Sentry.
      if (isExpectedOtpError(signErr)) {
        log.warn('auth.client_verify_failed', detail)
      } else {
        log.error('auth.client_verify_failed', signErr, detail)
      }
      return setError(verifyErrorMessage(reason, signErr))
    }
    // #414: the verify fetch resolves before the browser commits the session
    // Set-Cookie to its jar. If we hard-navigate to the guarded /week in the same
    // tick, on iOS Safari the SSR guard can run before the cookie commits, see no
    // session, and bounce us back to /sign-in. Confirm the session is readable
    // client-side FIRST (this read uses the same cookie jar the navigation will),
    // then navigate. confirmSession never throws and times out so we never hang.
    await confirmSession()
    // Push opt-in is moved OFF the verify tick (it raced the navigation and threw
    // SOUSO-Z). Fire it fully fire-and-forget AFTER the session is confirmed; it
    // must never block or abort the navigation (#149 prompt-on-auth).
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
                // Focus the code field the moment it appears (right after the
                // code email is sent) so the keyboard pops straight up.
                autoFocus
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
