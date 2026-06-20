import { useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import type { WaitlistView } from '#/lib/admin-server'
import { setMyWaitlistNotify } from '#/lib/admin-prefs-server'
import { cn } from '#/lib/utils'

/**
 * The marketing-landing waitlist: a per-admin email-notification toggle, a total
 * count, and the signups newest first. Read-only list; the toggle writes the
 * signed-in admin's own preference. Admin-gated upstream by the /admin guard.
 */
export function WaitlistPanel({
  waitlist,
  notifyEnabled,
}: {
  waitlist: WaitlistView
  notifyEnabled: boolean
}) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })

  return (
    <div className="max-w-2xl space-y-4">
      <NotifyToggle initial={notifyEnabled} />

      <div>
        <h2 className="text-lg font-semibold">
          {waitlist.count} {waitlist.count === 1 ? 'signup' : 'signups'}
        </h2>
        <p className="text-muted-foreground text-sm">
          Emails captured by the marketing landing, newest first.
        </p>
      </div>

      <div className="border-border divide-border divide-y rounded-xl border">
        {waitlist.rows.map((r) => (
          <div
            key={r.email}
            className="flex items-center justify-between px-4 py-3"
          >
            <span className="truncate text-sm font-medium">{r.email}</span>
            <span className="text-muted-foreground ml-3 shrink-0 text-xs">
              {fmt(r.createdAt)}
            </span>
          </div>
        ))}
        {waitlist.rows.length === 0 && (
          <p className="text-muted-foreground px-4 py-3 text-sm">
            No signups yet.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The signed-in admin's "email me on every new signup" switch. Optimistic: flips
 * immediately, reverts if the server write fails. On by default for all admins.
 */
function NotifyToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function toggle() {
    if (saving) return
    const next = !on
    setOn(next)
    setSaving(true)
    try {
      await setMyWaitlistNotify({ data: { enabled: next } })
    } catch {
      setOn(!next) // revert on failure
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-border bg-card flex items-center justify-between rounded-xl border px-4 py-3">
      <div className="flex items-center gap-3">
        {on ? (
          <Bell className="text-primary h-5 w-5" />
        ) : (
          <BellOff className="text-muted-foreground h-5 w-5" />
        )}
        <div>
          <p className="text-sm font-medium">Email me on every new signup</p>
          <p className="text-muted-foreground text-xs">
            {on
              ? 'You will get an email each time someone joins the waitlist.'
              : "You won't be emailed about new signups."}
          </p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Email me on every new waitlist signup"
        disabled={saving}
        onClick={toggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          on ? 'bg-primary' : 'bg-muted',
          saving && 'opacity-60',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            on ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}
