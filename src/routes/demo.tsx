import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { requireAdminBeforeLoad } from '#/lib/admin-server'
import { Button } from '#/components/ui/button'

/**
 * /demo — the PRESENTER panel for the live-pitch roulette. Admin-gated
 * (requireAdminBeforeLoad) so a random scanning the join QR can't open the
 * presenter view. Shows:
 *   - a big QR code encoding the absolute /demo/join URL (generated inline in
 *     the browser from window.location.origin via a dynamic `qrcode` import —
 *     no external call, and `qrcode` stays out of the route's split chunk),
 *   - a LIVE COUNTER polled every 2s (count ONLY, never the numbers),
 *   - a plain "numbers are not stored anywhere" note,
 *   - a Spin button that runs a roulette animation then picks one entrant and
 *     places the outbound Souso voice call (masked label is all we ever show).
 */
export const Route = createFileRoute('/demo')({
  beforeLoad: requireAdminBeforeLoad,
  component: PresenterPanel,
})

type SpinPhase = 'idle' | 'spinning' | 'revealed'

function PresenterPanel() {
  const [count, setCount] = useState<number | null>(null)
  const [qrSvg, setQrSvg] = useState<string>('')
  const [joinUrl, setJoinUrl] = useState<string>('')

  const [phase, setPhase] = useState<SpinPhase>('idle')
  const [reel, setReel] = useState<string>('•••• ••••')
  const [winner, setWinner] = useState<string | null>(null)
  const [called, setCalled] = useState<boolean | null>(null)
  const [callError, setCallError] = useState<string | null>(null)
  const [spinError, setSpinError] = useState<string | null>(null)

  const reelTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Build the absolute join URL + QR on mount (client-only — needs window).
  // `qrcode` is dynamically imported so it never lands in this route's split
  // chunk (a static top-level import failed to resolve its Node deps for the
  // browser); Vite resolves the package's `browser` entry for the dynamic load.
  useEffect(() => {
    const url = `${window.location.origin}/demo/join`
    setJoinUrl(url)
    void import('qrcode').then((mod) =>
      mod.default
        .toString(url, {
          type: 'svg',
          margin: 1,
          color: { dark: '#16341f', light: '#f5f1e7' },
        })
        .then(setQrSvg)
        .catch(() => setQrSvg('')),
    )
  }, [])

  // Poll the live count every 2s. Count only — the numbers never come back.
  const refreshCount = useCallback(async () => {
    try {
      const res = await fetch('/api/demo/count')
      if (!res.ok) return
      const body: { count?: number } = await res.json()
      if (typeof body.count === 'number') setCount(body.count)
    } catch {
      /* transient — keep the last good count */
    }
  }, [])

  useEffect(() => {
    void refreshCount()
    const id = setInterval(() => void refreshCount(), 2000)
    return () => clearInterval(id)
  }, [refreshCount])

  // Clean up the reel animation timer on unmount.
  useEffect(() => {
    return () => {
      if (reelTimer.current) clearInterval(reelTimer.current)
    }
  }, [])

  function startReel() {
    if (reelTimer.current) clearInterval(reelTimer.current)
    reelTimer.current = setInterval(() => {
      const a = Math.floor(Math.random() * 10)
      const b = Math.floor(Math.random() * 10)
      setReel(`•••• ••${a}${b}`)
    }, 80)
  }

  function stopReel() {
    if (reelTimer.current) {
      clearInterval(reelTimer.current)
      reelTimer.current = null
    }
  }

  async function spin() {
    if (phase === 'spinning') return
    setPhase('spinning')
    setWinner(null)
    setCalled(null)
    setCallError(null)
    setSpinError(null)
    startReel()

    // Fire the spin request and let the reel run for a beat regardless, so the
    // reveal always feels like a real draw even on a fast network.
    const reqP = fetch('/api/demo/spin', { method: 'POST' }).then(
      async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          masked?: string
          called?: boolean
          callError?: string | null
          error?: string
        }
        return { res, body }
      },
    )
    const delayP = new Promise((r) => setTimeout(r, 2200))

    try {
      const [{ res, body }] = await Promise.all([reqP, delayP])
      stopReel()
      if (!res.ok || !body.ok || !body.masked) {
        setPhase('idle')
        setReel('•••• ••••')
        setSpinError(body.error ?? 'Spin failed.')
        return
      }
      setReel(body.masked)
      setWinner(body.masked)
      setCalled(Boolean(body.called))
      setCallError(body.callError ?? null)
      setPhase('revealed')
      void refreshCount()
    } catch {
      stopReel()
      setPhase('idle')
      setReel('•••• ••••')
      setSpinError('Spin failed. Try again?')
    }
  }

  async function clearDraw() {
    try {
      await fetch('/api/demo/clear', { method: 'POST' })
    } catch {
      /* best effort */
    }
    setPhase('idle')
    setReel('•••• ••••')
    setWinner(null)
    setCalled(null)
    setCallError(null)
    setSpinError(null)
    void refreshCount()
  }

  return (
    <main className="bg-background min-h-[100dvh] px-6 py-10">
      <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-2 lg:items-start">
        {/* Left: the QR + how-to-join */}
        <section className="flex flex-col items-center gap-5 text-center">
          <div className="flex items-center gap-3">
            <img
              src="/brand/souso-v3-hello.png"
              alt="Souso"
              width={48}
              height={48}
              className="h-12 w-12 rounded-full object-contain"
            />
            <h1 className="text-foreground text-2xl font-bold">
              Scan to join the draw
            </h1>
          </div>

          <div className="border-border rounded-3xl border bg-white p-5 shadow-sm">
            {qrSvg ? (
              <div
                className="h-64 w-64"
                // qrcode renders a self-contained inline SVG (no external call).
                dangerouslySetInnerHTML={{ __html: qrSvg }}
                aria-label="QR code to join the draw"
                role="img"
              />
            ) : (
              <div className="text-muted-foreground flex h-64 w-64 items-center justify-center text-sm">
                Generating QR…
              </div>
            )}
          </div>

          {joinUrl && (
            <p className="text-muted-foreground text-sm break-all">{joinUrl}</p>
          )}
        </section>

        {/* Right: the counter + spin */}
        <section className="flex flex-col gap-6">
          <div className="border-border bg-card rounded-3xl border p-6 text-center">
            <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
              In the draw
            </p>
            <p className="text-primary mt-1 text-6xl font-extrabold tabular-nums">
              {count ?? '–'}
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              We show the count only — never the numbers.
            </p>
          </div>

          {/* The reel / reveal */}
          <div className="border-border bg-secondary/40 flex min-h-[120px] flex-col items-center justify-center rounded-3xl border p-6">
            <p
              className={
                'font-mono text-4xl font-bold tabular-nums transition-transform ' +
                (phase === 'spinning' ? 'scale-105 opacity-80' : 'scale-100')
              }
            >
              {reel}
            </p>
            {phase === 'revealed' && winner && (
              <div className="mt-3 text-center">
                <p className="text-foreground font-semibold">
                  Calling {winner}…
                </p>
                {called === true && (
                  <p className="text-primary mt-1 text-sm">
                    Souso is dialling now.
                  </p>
                )}
                {called === false && (
                  <p className="text-destructive mt-1 text-sm">
                    Call did not dispatch
                    {callError ? ` (${callError})` : ''}. Check VAPI config.
                  </p>
                )}
              </div>
            )}
            {spinError && (
              <p className="text-destructive mt-2 text-sm">{spinError}</p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <Button
              size="pill"
              onClick={spin}
              disabled={phase === 'spinning' || !count}
              className="w-full"
            >
              {phase === 'spinning' ? 'Spinning…' : 'Spin'}
            </Button>
            <Button
              variant="ghost"
              onClick={clearDraw}
              disabled={phase === 'spinning'}
              className="w-full"
            >
              Clear the draw
            </Button>
          </div>

          <div className="border-border bg-secondary/50 text-muted-foreground rounded-xl border p-3 text-xs leading-relaxed">
            <p className="text-foreground mb-1 font-semibold">
              Numbers are not stored anywhere.
            </p>
            <p>
              Entrants live only in memory (a Durable Object) for this session,
              never in a database and never logged. &ldquo;Clear the draw&rdquo;
              wipes them, and they vanish when the session ends.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
