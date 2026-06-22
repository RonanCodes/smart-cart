import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import confetti from 'canvas-confetti'
import { Rocket, PartyPopper, Undo2 } from 'lucide-react'
import { setLaunchState } from '#/lib/launch-server'
import type { LaunchStateView } from '#/lib/launch-server'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { Card } from '#/components/ui/card'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'

/**
 * Admin "Launch" panel: one control to flip Souso between waitlist mode and live.
 *
 * Going live removes the waitlist from the homepage and opens sign-in for
 * everyone; it is guarded by a confirm dialog and, on success, celebrated with a
 * confetti burst. An adjacent checkbox opts into emailing everyone we've
 * collected (waitlist ∪ users). Reverting to waitlist mode is the quiet inverse:
 * a confirm, no confetti, no email.
 */
export function LaunchPanel({ state }: { state: LaunchStateView }) {
  const queryClient = useQueryClient()
  const [notify, setNotify] = useState(true)
  const [confirmGoLive, setConfirmGoLive] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const launchedDate =
    state.launchedAt != null ? new Date(state.launchedAt) : null

  function celebrate() {
    // A quick two-burst confetti shower from the lower corners.
    const base = { spread: 70, startVelocity: 45, ticks: 220 }
    confetti({ ...base, particleCount: 90, origin: { x: 0.2, y: 0.9 } })
    confetti({ ...base, particleCount: 90, origin: { x: 0.8, y: 0.9 } })
  }

  async function goLive() {
    if (busy) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await setLaunchState({ data: { launched: true, notify } })
      celebrate()
      setMsg(
        notify
          ? `Live! Emailed ${res.notified} ${res.notified === 1 ? 'person' : 'people'}.`
          : 'Live! The waitlist is off and anyone can sign in.',
      )
      await queryClient.invalidateQueries({ queryKey: ['admin', 'launch'] })
    } catch {
      setMsg('Could not go live, try again.')
    } finally {
      setBusy(false)
      setConfirmGoLive(false)
    }
  }

  async function revert() {
    if (busy) return
    setBusy(true)
    setMsg(null)
    try {
      await setLaunchState({ data: { launched: false, notify: false } })
      setMsg('Back in waitlist mode. New sign-ins are gated again.')
      await queryClient.invalidateQueries({ queryKey: ['admin', 'launch'] })
    } catch {
      setMsg('Could not switch back, try again.')
    } finally {
      setBusy(false)
      setConfirmRevert(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <p className="text-primary text-[0.64rem] font-bold tracking-[0.16em] uppercase">
          Launch
        </p>
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Go live</h1>
        <p className="text-muted-foreground text-sm">
          Flip Souso from waitlist mode to live. Going live removes the waitlist
          from the homepage and lets anyone sign in.
        </p>
      </header>

      {/* Current status */}
      <Card ios className="flex items-center gap-3 p-5">
        {state.launched ? (
          <>
            <span className="bg-secondary text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
              <PartyPopper className="h-5 w-5" aria-hidden />
            </span>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">Live</p>
                <Badge variant="primary">Live</Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {launchedDate
                  ? `Live since ${launchedDate.toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}.`
                  : 'The waitlist is off and anyone can sign in.'}
              </p>
            </div>
          </>
        ) : (
          <>
            <span className="bg-secondary text-muted-foreground flex h-11 w-11 shrink-0 items-center justify-center rounded-full">
              <Rocket className="h-5 w-5" aria-hidden />
            </span>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">Waitlist mode</p>
                <Badge variant="outline">Waitlist</Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                The homepage shows the waitlist; only approved emails can sign
                in.
              </p>
            </div>
          </>
        )}
      </Card>

      {/* The action */}
      {state.launched ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setConfirmRevert(true)}
        >
          <Undo2 className="h-4 w-4" aria-hidden />
          Switch back to waitlist
        </Button>
      ) : (
        <Card ios className="space-y-4 p-5">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              disabled={busy}
              className="accent-primary mt-0.5 h-4 w-4 shrink-0"
            />
            <span>
              Email the waitlist and all users that we&apos;re live
              <span className="text-muted-foreground block text-xs">
                Sends a one-tap &ldquo;Souso is live&rdquo; email to everyone
                we&apos;ve collected.
              </span>
            </span>
          </label>
          <Button
            size="lg"
            disabled={busy}
            onClick={() => setConfirmGoLive(true)}
          >
            <Rocket className="h-4 w-4" aria-hidden />
            {busy ? 'Going live…' : 'Go live'}
          </Button>
        </Card>
      )}

      {msg && (
        <p
          role="status"
          className="text-muted-foreground bg-secondary rounded-[var(--radius-ios)] px-4 py-3 text-sm"
        >
          {msg}
        </p>
      )}

      <ConfirmDialog
        open={confirmGoLive}
        onOpenChange={setConfirmGoLive}
        title="Go live?"
        description={
          notify
            ? 'This removes the waitlist and lets anyone sign in. Everyone on the waitlist and every registered user gets a "Souso is live" email.'
            : 'This removes the waitlist and lets anyone sign in. No emails will be sent.'
        }
        confirmLabel="Go live"
        busy={busy}
        onConfirm={() => void goLive()}
      />

      <ConfirmDialog
        open={confirmRevert}
        onOpenChange={setConfirmRevert}
        title="Switch back to waitlist?"
        description="New sign-ins will be gated again and the homepage will show the waitlist. No emails are sent."
        confirmLabel="Switch to waitlist"
        destructive
        busy={busy}
        onConfirm={() => void revert()}
      />
    </div>
  )
}
