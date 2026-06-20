import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { ShoppingCart } from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { requestDemoCode } from '#/lib/demo-auth'
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

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: signErr } = await authClient.signIn.emailOtp({
      email,
      otp: code,
    })
    setBusy(false)
    if (signErr) return setError(signErr.message ?? 'That code did not work.')
    window.location.href = '/app'
  }

  // DEMO skip-login: email is down (Resend outage), so generate the code
  // server-side and sign in with it directly. Preserves the email identity.
  // Remove after the demo.
  async function skipEmail() {
    if (!email) return setError('Enter your email first.')
    setBusy(true)
    setError(null)
    try {
      const { otp } = await requestDemoCode({ data: { email } })
      const { error: signErr } = await authClient.signIn.emailOtp({
        email,
        otp,
      })
      if (signErr) throw new Error(signErr.message ?? 'Sign-in failed.')
      window.location.href = '/app'
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Could not skip sign-in.')
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <ShoppingCart className="text-primary mb-2 h-8 w-8" />
          <CardTitle>Sign in to Souso</CardTitle>
          <CardDescription>
            {step === 'email'
              ? 'We email you a 6-digit code. No password.'
              : `Enter the code we sent to ${email}.`}
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
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={skipEmail}
              >
                Skip email (demo, Resend is down)
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-3">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Checking…' : 'Sign in'}
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
