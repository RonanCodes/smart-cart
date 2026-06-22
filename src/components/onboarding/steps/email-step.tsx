import * as React from 'react'
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

/**
 * EmailStep — the FINAL step of onboarding (TJ's design): the user has invested
 * the whole form first, THEN gives their email. There is NO email prompt up
 * front. This step collects the email, sends a 6-digit OTP, and on a successful
 * verify CREATES + authenticates the account (Better Auth emailOTP open sign-up:
 * a first-time email is created on verify, `disableSignUp` is not set).
 *
 * It is deliberately NOT a generic STEPS entry: it owns its own two-substep
 * email -> code flow and its own CTA, instead of the shell's "Next" footer. The
 * shell renders it as the terminal `auth` phase. After verify succeeds the
 * session cookie is set in the browser, so the parent calls `completeOnboarding`
 * (a server fn reading that cookie) and routes to /week.
 *
 * Reuses the recently-hardened sign-in behaviour: the code is digit-stripped
 * (iOS one-tap autofill / email spacing can inject spaces that fail the
 * exact-match verify), errors are reason-aware, resend is available, and every
 * failure is logged server-side with the page origin (the signal an "Invalid
 * origin" rejection turns on). Do NOT revert those.
 *
 * Error classification (#387): a wrong / expired / rate-limited OTP is EXPECTED
 * user behaviour (a handled 4xx) and is logged as a warn breadcrumb, NOT a
 * Sentry exception. The shared classifier lives in `#/lib/otp-error`.
 */

export function EmailStep({
  onVerified,
}: {
  /** Fired after a successful OTP verify, once the session cookie is set. The
   * parent then persists the draft + builds the week. */
  onVerified: () => void
}) {
  const [substep, setSubstep] = React.useState<'email' | 'code'>('email')
  const [email, setEmail] = React.useState('')
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // Capture the email the user entered on EVERY request (not just failures),
    // so an OTP issue (e.g. Android autofill) is traceable by email + device.
    log.info('onboarding.otp_requested', {
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
    if (sendErr) {
      log.error('onboarding.otp_send_failed', sendErr, {
        email,
        status: (sendErr as { status?: number }).status,
        origin: typeof window !== 'undefined' ? window.location.origin : null,
      })
      return setError(sendErr.message ?? 'Could not send the code.')
    }
    setSubstep('code')
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
      log.error('onboarding.otp_resend_failed', sendErr, {
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
    // emailOTP open sign-up: a first-time email is created + authenticated here;
    // an existing email is simply signed in. Either way the session cookie is set
    // before we hand back to the parent to build the week.
    const { error: signErr } = await authClient.signIn.emailOtp({ email, otp })
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
      // #387: a wrong / expired / rate-limited OTP is EXPECTED user behaviour
      // (a handled 4xx) — surface it inline and log a warn breadcrumb, not a
      // Sentry exception. Only an unexpected / 5xx failure stays log.error.
      if (isExpectedOtpError(signErr)) {
        log.warn('onboarding.otp_verify_failed', detail)
      } else {
        log.error('onboarding.otp_verify_failed', signErr, detail)
      }
      return setError(verifyErrorMessage(reason, signErr))
    }
    // #414: onVerified() hands off to the parent, which immediately calls the
    // completeOnboarding server fn that READS the session cookie. The verify fetch
    // resolves before the browser commits that Set-Cookie, so on iOS Safari the
    // server fn can run before the cookie is readable and fail / bounce. Confirm
    // the session client-side FIRST (same cookie jar), then hand off. confirmSession
    // never throws and times out so onboarding never hangs.
    await confirmSession()
    // Push opt-in moved OFF the verify tick (it raced the handoff and threw
    // SOUSO-Z). Fully fire-and-forget AFTER the session is confirmed; never blocks
    // or breaks completing onboarding (#149 prompt-on-auth).
    void promptForNotifications()
    onVerified()
  }

  return (
    <div className="flex flex-col gap-4" data-testid="onboarding-email-step">
      {substep === 'email' ? (
        <form onSubmit={sendCode} className="space-y-3">
          <p className="text-muted-foreground text-sm">
            We email you a 6-digit code to save your plan. No password.
          </p>
          <Input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-full text-base"
          />
          <Button
            type="submit"
            size="pill"
            className="w-full"
            disabled={busy || !email.trim()}
            data-testid="onboarding-email-send"
          >
            {busy ? 'Sending…' : 'Email me a code'}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Enter the code we sent to {email}. Check your spam folder if you do
            not see it.
          </p>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            className="h-12 rounded-full text-center text-lg tracking-[0.4em]"
          />
          <Button
            type="submit"
            size="pill"
            className="w-full"
            disabled={busy}
            data-testid="onboarding-email-verify"
          >
            {busy ? 'Building your week…' : 'Build my week'}
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
            onClick={() => {
              setSubstep('email')
              setError(null)
            }}
            disabled={busy}
          >
            Use a different email
          </Button>
        </form>
      )}
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
