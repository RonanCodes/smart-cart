import { useState } from 'react'
import type { ReactNode } from 'react'
import { Bell, BellOff, Check, Shield } from 'lucide-react'
import type { WaitlistView, GrantState } from '#/lib/admin-server'
import { grantUser, grantAdmin } from '#/lib/admin-server'
import { setMyWaitlistNotify } from '#/lib/admin-prefs-server'
import { cn } from '#/lib/utils'

/**
 * The marketing-landing waitlist: a per-admin email-notification toggle, a total
 * count, and the signups newest first. Each row shows the signup date AND time,
 * plus two actions, "Approve as user" and "Make admin", that grant DB-backed
 * access with no redeploy and reflect the current grant state. Admin-gated
 * upstream by the /admin guard.
 */
export function WaitlistPanel({
  waitlist,
  notifyEnabled,
}: {
  waitlist: WaitlistView
  notifyEnabled: boolean
}) {
  return (
    <div className="max-w-2xl space-y-4">
      <NotifyToggle initial={notifyEnabled} />

      <div>
        <h2 className="text-lg font-semibold">
          {waitlist.count} {waitlist.count === 1 ? 'signup' : 'signups'}
        </h2>
        <p className="text-muted-foreground text-sm">
          Emails captured by the marketing landing, newest first. Approve to
          grant login access, or make someone an admin, no redeploy needed.
        </p>
      </div>

      <div className="border-border divide-border divide-y rounded-xl border">
        {waitlist.rows.map((r) => (
          <WaitlistRow
            key={r.email}
            email={r.email}
            createdAt={r.createdAt}
            initialGrant={r.grant}
          />
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

/** Date + time, e.g. "20 Jun 2026, 14:32". */
function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * One waitlist signup with its grant actions. Mobile-first: email + timestamp
 * stack above the action buttons on narrow screens, sit inline from `sm` up.
 * Optimistic: the grant state flips immediately and reverts if the server write
 * fails. "Approve as user" is hidden once the email is already a user OR admin;
 * "Make admin" relabels to "Admin" and disables once the email is an admin.
 */
function WaitlistRow({
  email,
  createdAt,
  initialGrant,
}: {
  email: string
  createdAt: string
  initialGrant: GrantState
}) {
  const [grant, setGrant] = useState<GrantState>(initialGrant)
  const [saving, setSaving] = useState(false)

  async function run(
    next: GrantState,
    fn: (args: { data: { email: string } }) => Promise<{ grant: GrantState }>,
  ) {
    if (saving) return
    const prev = grant
    setGrant(next)
    setSaving(true)
    try {
      const res = await fn({ data: { email } })
      setGrant(res.grant)
    } catch {
      setGrant(prev) // revert on failure
    } finally {
      setSaving(false)
    }
  }

  const isUser = grant === 'user'
  const isAdmin = grant === 'admin'

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <span className="block truncate text-sm font-medium">{email}</span>
        <span className="text-muted-foreground text-xs">
          {fmtDateTime(createdAt)}
        </span>
      </div>

      <div className="flex shrink-0 gap-2">
        {/* Approve as user: shown only when not yet granted. Admin already
            implies login access, so a granted/admin email needs no user button. */}
        {grant === 'none' ? (
          <GrantButton
            label="Approve as user"
            icon={<Check className="h-4 w-4" />}
            saving={saving}
            onClick={() => run('user', grantUser)}
          />
        ) : isUser ? (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium">
            <Check className="h-4 w-4" /> User
          </span>
        ) : null}

        {/* Make admin: relabels + disables once the email is an admin. */}
        {isAdmin ? (
          <span className="text-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium">
            <Shield className="h-4 w-4" /> Admin
          </span>
        ) : (
          <GrantButton
            label="Make admin"
            icon={<Shield className="h-4 w-4" />}
            primary
            saving={saving}
            onClick={() => run('admin', grantAdmin)}
          />
        )}
      </div>
    </div>
  )
}

/** A single grant action button. Touch-friendly (min 44px tall via py-2 + text). */
function GrantButton({
  label,
  icon,
  primary,
  saving,
  onClick,
}: {
  label: string
  icon: ReactNode
  primary?: boolean
  saving: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={saving}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
        primary
          ? 'bg-primary text-primary-foreground hover:opacity-90'
          : 'border-border bg-card text-foreground hover:bg-muted border',
        saving && 'opacity-60',
      )}
    >
      {icon}
      {label}
    </button>
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
