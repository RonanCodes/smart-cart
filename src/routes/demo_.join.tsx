import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

/**
 * /demo/join — the PUBLIC page behind the QR code at a live pitch. Anyone in the
 * audience scans the code, lands here, types their number, and they're in the
 * draw. The page states plainly that the number is NOT stored and is used only
 * for this one live demo (explicit consent). On submit the number goes to the
 * in-memory roulette store and they see a friendly confirmation.
 */
export const Route = createFileRoute('/demo_/join')({ component: JoinDraw })

function JoinDraw() {
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'joined'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function join(e: React.FormEvent) {
    e.preventDefault()
    setState('busy')
    setError(null)
    try {
      const res = await fetch('/api/demo/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !body.ok) {
        setState('idle')
        setError(body.error ?? 'Something went wrong. Try again?')
        return
      }
      setState('joined')
    } catch {
      setState('idle')
      setError('Could not reach the draw. Try again?')
    }
  }

  return (
    <main className="bg-background flex min-h-[100dvh] items-center justify-center px-6 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img
            src="/brand/souso-v3-hello.png"
            alt="Souso"
            width={56}
            height={56}
            className="mb-2 h-14 w-14 rounded-full object-contain"
          />
          {state === 'joined' ? (
            <>
              <CardTitle>You&apos;re in the draw!</CardTitle>
              <CardDescription>
                Keep your phone handy. If Souso picks you, you&apos;ll get a
                call in a moment.
              </CardDescription>
            </>
          ) : (
            <>
              <CardTitle>Join Souso&apos;s live draw</CardTitle>
              <CardDescription>
                Pop your number in for a chance to get a live call from Souso on
                stage.
              </CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          {state === 'joined' ? (
            <div className="flex flex-col items-center gap-3">
              <img
                src="/brand/souso-v3-celebrate.png"
                alt=""
                aria-hidden
                width={96}
                height={96}
                className="h-24 w-24 object-contain"
              />
              <p className="text-muted-foreground text-center text-sm">
                Your number is held only in memory for this one demo and is
                wiped straight after. It&apos;s never saved.
              </p>
            </div>
          ) : (
            <form onSubmit={join} className="space-y-4">
              <Input
                type="tel"
                required
                inputMode="tel"
                autoComplete="tel"
                placeholder="06 12 34 56 89"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-label="Your phone number"
              />
              <Button
                type="submit"
                size="pill"
                disabled={state === 'busy'}
                className="w-full"
              >
                {state === 'busy' ? 'Joining…' : "I'm in"}
              </Button>
              {error && <p className="text-destructive text-sm">{error}</p>}

              {/* The consent / privacy note — load-bearing for this feature. */}
              <div className="border-border bg-secondary/50 text-muted-foreground rounded-xl border p-3 text-xs leading-relaxed">
                <p className="text-foreground mb-1 font-semibold">
                  Your number is not stored anywhere.
                </p>
                <p>
                  By entering it you consent to one live demo call. It&apos;s
                  held only in memory for this session, never written to a
                  database, never logged, and wiped right after the pitch.
                </p>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
