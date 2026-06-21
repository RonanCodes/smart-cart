import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
  ThumbsUp,
  ThumbsDown,
  Bell,
  ShieldOff,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react'
import {
  getUserDatapoints,
  revokeAdmin,
  resetUserData,
  resetAllUsersData,
} from '#/lib/admin-server'
import type { AdminUserRow, UserDatapoints } from '#/lib/admin-server'
import { sendRateMealPush } from '#/lib/push-server'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Sheet } from '#/components/ui/sheet'

/**
 * Short human label for a person's access state, factoring onboarding in: an
 * onboarded real user reads 'Onboarded', a granted/approved-but-never-onboarded
 * person reads 'Approved user', and a bare user row with no grant reads 'Not
 * onboarded'. Returns null for admins: the dedicated primary 'Admin' badge
 * already covers them, so emitting an 'Admin' access tag too would duplicate
 * the indicator on the row.
 */
function accessTag(u: AdminUserRow): string | null {
  if (u.access === 'admin') return null
  if (u.onboarded) return 'Onboarded'
  if (u.access === 'user') return 'Approved user'
  return 'Not onboarded'
}

/**
 * The synthetic-users list + per-user data-points drill-down. Extracted verbatim
 * from the original /admin route so BOTH the Users tab and the Benchmark tab render
 * the exact same view (the benchmark tab embeds it for the "view synthetic users +
 * data points" requirement) without rebuilding it.
 */
export function UsersPanel({
  users,
  viewerIsSuperAdmin = false,
}: {
  users: Array<AdminUserRow>
  /** Super-admins (server-decided) see the destructive 'Reset ALL users' button. */
  viewerIsSuperAdmin?: boolean
}) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [detail, setDetail] = useState<UserDatapoints | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  // Mobile-only: tapping a user opens the detail in a bottom sheet (there is no
  // side-by-side "right panel" at < lg). Desktop ignores this and renders the
  // detail inline. Closing the sheet does not clear `detail`, so the desktop
  // panel keeps showing the last opened user.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [pushBusy, setPushBusy] = useState<string | null>(null)
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  // Emails revoked this session (drop the Admin badge + the Remove action without
  // a reload) and the email mid-revoke (disable its button).
  const [revoked, setRevoked] = useState<Set<string>>(() => new Set())
  const [revokingEmail, setRevokingEmail] = useState<string | null>(null)

  async function revoke(email: string) {
    if (revokingEmail) return
    setRevokingEmail(email)
    try {
      await revokeAdmin({ data: { email } })
      setRevoked((s) => new Set(s).add(email))
    } catch {
      // leave the row as-is; the server rejected it.
    } finally {
      setRevokingEmail(null)
    }
  }

  // Reset-to-fresh state. `confirmResetId` is the userId whose row is showing the
  // inline "Reset?" confirm; `resettingId` is the one mid-request (disables it).
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null)
  const [resettingId, setResettingId] = useState<string | null>(null)
  // Reset-ALL is a two-step strong confirm (super-admin only): first click arms
  // it, second click within the armed window fires. `resetAllBusy` disables it.
  const [resetAllArmed, setResetAllArmed] = useState(false)
  const [resetAllBusy, setResetAllBusy] = useState(false)
  const [resetAllMsg, setResetAllMsg] = useState<string | null>(null)

  // Re-read the users + super-admin flag after any reset so badges/swipes/access
  // tags reflect the now-wiped state without a full page reload.
  async function refreshUsers() {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  }

  async function resetUser(userId: string) {
    if (resettingId) return
    setResettingId(userId)
    try {
      const res = await resetUserData({ data: { userId } })
      // Resetting your OWN account wipes your household, but the live router's
      // auth context still thinks you have one — so drop straight into
      // onboarding instead of leaving you on a now-stale admin page. Invalidate
      // first so the guard + onboarding loader re-resolve server-side.
      if (res.wasSelf) {
        await router.invalidate()
        await router.navigate({ to: '/onboarding' })
        return
      }
      await refreshUsers()
    } catch {
      // leave the row as-is; the server rejected it.
    } finally {
      setResettingId(null)
      setConfirmResetId(null)
    }
  }

  async function resetAll() {
    if (resetAllBusy) return
    // First click arms the confirm; only the second (armed) click fires.
    if (!resetAllArmed) {
      setResetAllArmed(true)
      return
    }
    setResetAllBusy(true)
    setResetAllMsg(null)
    try {
      const res = await resetAllUsersData()
      setResetAllMsg(`Reset ${res.householdsCleared} household(s) to fresh.`)
      await refreshUsers()
    } catch {
      setResetAllMsg('Could not reset all users, try again.')
    } finally {
      setResetAllBusy(false)
      setResetAllArmed(false)
    }
  }

  async function open(userId: string) {
    setLoadingId(userId)
    setSheetOpen(true) // no-op on desktop (sheet is lg:hidden)
    setDetail(await getUserDatapoints({ data: { userId } }))
    setLoadingId(null)
  }

  // Send a "rate the meal" push. `target` is a userId, or 'all' for everyone.
  // Stops row clicks from also opening the data-points drawer.
  async function sendPush(target: string | 'all') {
    setPushBusy(target)
    setPushMsg(null)
    try {
      const res =
        target === 'all'
          ? await sendRateMealPush({ data: { all: true } })
          : await sendRateMealPush({ data: { userId: target } })
      setPushMsg(res.message)
    } catch {
      setPushMsg('Could not send the push, try again.')
    } finally {
      setPushBusy(null)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      {/* Users */}
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
          <Button
            size="sm"
            variant="outline"
            disabled={pushBusy !== null}
            onClick={() => void sendPush('all')}
          >
            <Bell className="h-4 w-4" aria-hidden />
            {pushBusy === 'all' ? 'Sending…' : 'Send rate-meal push to all'}
          </Button>
          {/* Reset ALL users: super-admin only, destructive, two-step confirm.
              First tap arms (turns red + says "Tap again"), second tap fires. */}
          {viewerIsSuperAdmin && (
            <Button
              size="sm"
              variant={resetAllArmed ? 'destructive' : 'outline'}
              disabled={resetAllBusy}
              onClick={() => void resetAll()}
            >
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {resetAllBusy
                ? 'Resetting all…'
                : resetAllArmed
                  ? 'Tap again to reset ALL users'
                  : 'Reset ALL users to fresh'}
            </Button>
          )}
        </div>
        {viewerIsSuperAdmin && resetAllArmed && !resetAllBusy && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            This wipes EVERY user&apos;s household data (swipes, plans, shopping
            lists, staples, push) and forces them all to re-onboard. Accounts
            stay signed in. Tap again to confirm.
          </p>
        )}
        {resetAllMsg && (
          <p
            role="status"
            className="text-muted-foreground bg-secondary rounded-lg px-3 py-2 text-xs"
          >
            {resetAllMsg}
          </p>
        )}
        {pushMsg && (
          <p
            role="status"
            className="text-muted-foreground bg-secondary rounded-lg px-3 py-2 text-xs"
          >
            {pushMsg}
          </p>
        )}
        {users.map((u) => {
          // No user row -> nothing to drill into; render a static card so the
          // operator still sees the person, their admin badge + access tag.
          const interactive = u.userId !== null
          const isRevoked = revoked.has(u.email)
          // Hide the Admin badge + revoke action once revoked this session.
          const showAdmin = u.isAdmin && !isRevoked
          return (
            <div key={u.email} className="flex items-stretch gap-2">
              <button
                onClick={() => interactive && open(u.userId!)}
                disabled={!interactive}
                className="border-border enabled:hover:bg-secondary flex min-w-0 flex-1 items-center justify-between rounded-lg border px-4 py-3 text-left transition disabled:cursor-default disabled:opacity-70"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {u.email}
                    </span>
                    {showAdmin && (
                      <Badge variant="primary" className="shrink-0">
                        Admin
                      </Badge>
                    )}
                    {u.configAdmin && !isRevoked && (
                      <Badge variant="outline" className="shrink-0">
                        config admin
                      </Badge>
                    )}
                    {/* One status tag per row. Admins are covered by the
                        primary 'Admin' badge above (accessTag returns null),
                        so no duplicate 'Admin' tag here. Once an admin is
                        revoked this session, surface their underlying user
                        state instead of leaving the row untagged. */}
                    {(() => {
                      const tag =
                        isRevoked && u.access === 'admin'
                          ? u.onboarded
                            ? 'Onboarded'
                            : 'Approved user'
                          : accessTag(u)
                      return tag ? (
                        <Badge variant="outline" className="shrink-0">
                          {tag}
                        </Badge>
                      ) : null
                    })()}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {u.badges.slice(0, 3).map((b) => (
                      <span key={b.label} className="text-xs">
                        {b.emoji} {b.label}
                      </span>
                    ))}
                    {u.badges.length === 0 && (
                      <span className="text-muted-foreground text-xs">
                        {u.onboarded ? 'no badges yet' : 'not onboarded'}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-muted-foreground ml-3 shrink-0 text-xs">
                  {u.swipes} swipes
                </span>
              </button>
              {interactive && (
                <button
                  type="button"
                  aria-label={`Send rate-meal push to ${u.email}`}
                  disabled={pushBusy !== null}
                  onClick={() => void sendPush(u.userId!)}
                  className="border-border text-muted-foreground enabled:hover:bg-secondary inline-flex w-11 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-50"
                >
                  <Bell className="h-4 w-4" aria-hidden />
                </button>
              )}
              {/* Remove admin: super-admin only (server sets revocable), on
                  DB-granted admins only. Hidden once revoked this session. */}
              {u.revocable && !isRevoked && (
                <button
                  type="button"
                  aria-label={`Remove admin from ${u.email}`}
                  disabled={revokingEmail !== null}
                  onClick={() => void revoke(u.email)}
                  className="inline-flex w-11 shrink-0 items-center justify-center rounded-lg border border-red-300 text-red-600 transition enabled:hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:enabled:hover:bg-red-950"
                >
                  <ShieldOff className="h-4 w-4" aria-hidden />
                </button>
              )}
              {/* Reset this user to fresh: admin action with an inline confirm.
                  First tap arms (shows a red "Reset?" + cancel), second fires.
                  Only on real user rows (a userId to reset). */}
              {interactive &&
                (confirmResetId === u.userId ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Confirm reset ${u.email} to fresh`}
                      disabled={resettingId !== null}
                      onClick={() => void resetUser(u.userId!)}
                      className="inline-flex h-full items-center justify-center rounded-lg border border-red-300 px-2 text-xs font-semibold text-red-600 transition enabled:hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:enabled:hover:bg-red-950"
                    >
                      {resettingId === u.userId ? 'Resetting…' : 'Reset?'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Cancel reset ${u.email}`}
                      disabled={resettingId !== null}
                      onClick={() => setConfirmResetId(null)}
                      className="border-border text-muted-foreground enabled:hover:bg-secondary inline-flex h-full items-center justify-center rounded-lg border px-2 text-xs transition disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-label={`Reset ${u.email} to fresh`}
                    disabled={resettingId !== null}
                    onClick={() => setConfirmResetId(u.userId)}
                    className="border-border text-muted-foreground enabled:hover:bg-secondary inline-flex w-11 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden />
                  </button>
                ))}
            </div>
          )
        })}
        {users.length === 0 && (
          <p className="text-muted-foreground text-sm">No users yet.</p>
        )}
      </div>

      {/* Detail — desktop only. At lg+ the detail sits side-by-side with the
          list in the real width the data needs. Below lg it is hidden (the
          column would have no room) and the mobile sheet takes over, so the
          old squashed "Select a user on the left" sliver is gone on phones. */}
      <div className="border-border hidden min-h-[60vh] min-w-0 rounded-xl border p-5 lg:block">
        {loadingId && !detail ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : detail ? (
          <DatapointsDetail detail={detail} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Select a user on the left.
          </p>
        )}
      </div>

      {/* Detail — mobile sheet. Slides up when a user is tapped on a narrow
          screen; desktop never sees it (lg:hidden), so there is no double
          render. */}
      <div className="lg:hidden">
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={detail?.email ?? 'User data points'}
        >
          {loadingId && !detail ? (
            <p className="text-muted-foreground py-6 text-sm">Loading…</p>
          ) : detail ? (
            <div className="pb-2">
              <DatapointsDetail detail={detail} hideEmailHeader />
            </div>
          ) : null}
        </Sheet>
      </div>
    </div>
  )
}

/**
 * The per-user data-points read: inferred badges, loved/disliked tastes, and
 * the raw swipe list. Shared by the desktop side-by-side panel and the mobile
 * bottom sheet so both render the exact same content. `hideEmailHeader` drops
 * the email title in the sheet, where the sheet title already carries it.
 */
function DatapointsDetail({
  detail,
  hideEmailHeader,
}: {
  detail: UserDatapoints
  hideEmailHeader?: boolean
}) {
  return (
    <div className="space-y-5">
      {!hideEmailHeader && (
        <div>
          <h2 className="font-semibold">{detail.email}</h2>
          <p className="text-muted-foreground text-sm">
            What we think they like
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {detail.badges.map((b) => (
          <span
            key={b.label}
            className="bg-secondary inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm"
          >
            {b.emoji} {b.label}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {detail.lovedTastes.map((t) => (
          <Badge key={t} variant="primary">
            {t}
          </Badge>
        ))}
        {detail.dislikes.map((t) => (
          <Badge key={t} variant="outline">
            no {t}
          </Badge>
        ))}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Data points ({detail.swipes.length} swipes)
        </h3>
        <div className="max-h-[50vh] space-y-1 overflow-auto">
          {detail.swipes.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b py-1.5 text-sm"
            >
              <span className="flex items-center gap-2 truncate">
                {s.direction === 'like' ? (
                  <ThumbsUp className="text-primary h-4 w-4 shrink-0" />
                ) : (
                  <ThumbsDown className="h-4 w-4 shrink-0 text-red-500" />
                )}
                <span className="truncate">{s.recipeTitle}</span>
              </span>
              <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                {s.cuisine ?? ''}
              </span>
            </div>
          ))}
          {detail.swipes.length === 0 && (
            <p className="text-muted-foreground text-sm">No swipes.</p>
          )}
        </div>
      </div>
    </div>
  )
}
