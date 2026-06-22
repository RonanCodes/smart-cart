import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  BellOff,
  Check,
  Shield,
  ShieldOff,
  CheckCheck,
} from 'lucide-react'
import type {
  WaitlistView,
  WaitlistRowView,
  GrantState,
} from '#/lib/admin-server'
import {
  grantUser,
  grantAdmin,
  revokeAdmin,
  approveAllWaitlist,
  pendingApprovableEmails,
  waitlistRowActions,
} from '#/lib/admin-server'
import { setMyWaitlistNotify } from '#/lib/admin-prefs-server'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Badge } from '#/components/ui/badge'
import { ConfirmDialog } from '#/components/ui/confirm-dialog'
import { cn } from '#/lib/utils'

/**
 * The marketing-landing waitlist: a per-admin email-notification toggle, a total
 * count, and the signups newest first. Each row shows the signup date AND time,
 * plus two actions, "Approve as user" and "Make admin", that grant DB-backed
 * access with no redeploy and reflect the current grant state. Admin-gated
 * upstream by the /admin guard.
 *
 * Styled to the Souso design system: an on-brand page header, the per-admin
 * notify switch in its own iOS-radius card, and the signups grouped into one
 * calm card with airy hairline rows.
 */
export function WaitlistPanel({
  waitlist,
  notifyEnabled,
}: {
  waitlist: WaitlistView
  notifyEnabled: boolean
}) {
  const queryClient = useQueryClient()
  // Emails that "Approve all" would grant: the not-yet-granted, non-admin rows.
  // Derived with the SAME pure rule the server uses, so the count on the button
  // and what the server actually grants never drift.
  const pending = pendingApprovableEmails(waitlist.rows)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approveMsg, setApproveMsg] = useState<string | null>(null)

  async function approveAll() {
    if (approving) return
    setApproving(true)
    setApproveMsg(null)
    try {
      const res = await approveAllWaitlist()
      setApproveMsg(
        res.approved === 0
          ? 'Nothing pending to approve.'
          : `Approved ${res.approved} ${res.approved === 1 ? 'email' : 'emails'}.`,
      )
      // Re-read the waitlist so every approved row flips to its 'Approved' tag.
      await queryClient.invalidateQueries({ queryKey: ['admin', 'waitlist'] })
    } catch {
      setApproveMsg('Could not approve all, try again.')
    } finally {
      setApproving(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <header>
        <h1 className="text-xl font-bold tracking-[-0.01em]">Waitlist</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Emails captured by the marketing landing, newest first. Approve to
          grant login access, or make someone an admin, no redeploy needed.
        </p>
      </header>

      <NotifyToggle initial={notifyEnabled} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-foreground text-base font-semibold">
          {waitlist.count} {waitlist.count === 1 ? 'signup' : 'signups'}
        </p>
        {/* Approve all: only when there is something pending. Guarded by a
            confirm dialog so a tap can't grant access to everyone by accident. */}
        {pending.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={approving}
            onClick={() => setConfirmOpen(true)}
            className="shrink-0"
          >
            <CheckCheck className="h-4 w-4" aria-hidden />
            {approving ? 'Approving…' : `Approve all (${pending.length})`}
          </Button>
        )}
      </div>

      {approveMsg && (
        <p
          role="status"
          className="text-muted-foreground bg-secondary rounded-xl px-3 py-2 text-xs"
        >
          {approveMsg}
        </p>
      )}

      <Card ios className="divide-border divide-y overflow-hidden">
        {waitlist.rows.map((r) => (
          <WaitlistRow key={r.email} row={r} />
        ))}
        {waitlist.rows.length === 0 && (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">
            No signups yet.
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Approve all ${pending.length} pending ${pending.length === 1 ? 'email' : 'emails'}?`}
        description="Each gets login access right away. Admins and already-approved users are left as they are."
        confirmLabel="Approve all"
        busy={approving}
        onConfirm={() => void approveAll()}
      />
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
 *
 * Super-admin only: a DB-granted admin row (`row.revocable`) gets a "Remove
 * admin" action. An env/owner admin (`row.configAdmin`) shows a static "config
 * admin" tag and no revoke (it is config, not a runtime grant). Non-super-admins
 * never receive a revocable row, so the action never renders for them.
 */
function WaitlistRow({ row }: { row: WaitlistRowView }) {
  const { email, createdAt, configAdmin, revocable } = row
  const [grant, setGrant] = useState<GrantState>(row.grant)
  const [saving, setSaving] = useState(false)
  // Make-admin is an elevating action, so it goes through a confirm dialog first.
  const [confirmAdminOpen, setConfirmAdminOpen] = useState(false)

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

  // Derive the per-state controls from the (server-decided) grant + flags. The
  // optimistic `grant` is the only value that changes after a click; configAdmin
  // and revocable come straight from the row. See waitlistRowActions for the
  // full state matrix (and its unit test for the proof it's right).
  const actions = waitlistRowActions({ grant, configAdmin, revocable })

  return (
    // Mobile-first: email + date on their own full-width line, the action
    // controls in a second row that wraps. The email NEVER competes with the
    // buttons for width, so it can always render (truncating with an ellipsis
    // only when the email itself is too long). From `sm` up the controls sit
    // inline to the right of the email.
    <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{email}</span>
        {/*
          toLocaleString resolves to the runtime's locale + timezone, which
          differs between the SSR Worker (UTC) and the browser, so the server and
          client strings mismatch -> React #418 hydration warning on /admin.
          The value is cosmetic, so suppress the warning on just this node rather
          than forcing a fixed timezone (the browser-local time is what we want).
        */}
        <span
          className="text-muted-foreground text-xs"
          suppressHydrationWarning
        >
          {fmtDateTime(createdAt)}
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/* Approve as user: not-yet-granted, non-admin rows only. */}
        {actions.approveAsUser && (
          <GrantButton
            label="Approve as user"
            icon={<Check className="h-4 w-4" />}
            saving={saving}
            onClick={() => run('user', grantUser)}
          />
        )}

        {/* Approved: a plain user who already has login access. Static tag. */}
        {actions.approvedTag && (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium">
            <Check className="h-4 w-4" /> Approved
          </span>
        )}

        {/* Admin badge: any admin (DB-granted OR config). */}
        {actions.adminBadge && (
          <Badge variant="primary" className="gap-1.5">
            <Shield className="h-3.5 w-3.5" /> Admin
          </Badge>
        )}

        {/* config admin: env/owner admin, not a DB grant -> no revoke, no
            approve/make-admin. */}
        {actions.configAdminTag && (
          <Badge variant="outline" className="text-muted-foreground">
            config admin
          </Badge>
        )}

        {/* Make admin: non-admin rows only (relabels to the Admin badge above
            once promoted). Confirmed first, since it elevates access. */}
        {actions.makeAdmin && (
          <GrantButton
            label="Make admin"
            icon={<Shield className="h-4 w-4" />}
            primary
            saving={saving}
            onClick={() => setConfirmAdminOpen(true)}
          />
        )}

        {/* Remove admin: super-admin only, DB-granted admins only. Hides once
            the grant drops below admin (after a successful revoke). */}
        {actions.removeAdmin && (
          <GrantButton
            label="Remove admin"
            icon={<ShieldOff className="h-4 w-4" />}
            destructive
            saving={saving}
            onClick={() => run('none', revokeAdmin)}
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmAdminOpen}
        onOpenChange={setConfirmAdminOpen}
        title={`Make ${email} an admin?`}
        description="Admins can see the console and grant access to others."
        confirmLabel="Make admin"
        busy={saving}
        onConfirm={() => {
          setConfirmAdminOpen(false)
          void run('admin', grantAdmin)
        }}
      />
    </div>
  )
}

/**
 * A single grant action button on the Souso primitives. Touch-friendly (the
 * `sm` size is a 44px-tall pill). `primary` is the green action, `destructive`
 * the red revoke, the default an outline.
 */
function GrantButton({
  label,
  icon,
  primary,
  destructive,
  saving,
  onClick,
}: {
  label: string
  icon: ReactNode
  primary?: boolean
  destructive?: boolean
  saving: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={destructive ? 'destructive' : primary ? 'default' : 'outline'}
      disabled={saving}
      onClick={onClick}
      className={cn('text-xs', saving && 'opacity-60')}
    >
      {icon}
      {label}
    </Button>
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
    <Card ios className="flex items-center justify-between gap-3 px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            on ? 'bg-secondary text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {on ? (
            <Bell className="h-[1.15rem] w-[1.15rem]" />
          ) : (
            <BellOff className="h-[1.15rem] w-[1.15rem]" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Email me on every new signup</p>
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
    </Card>
  )
}
