import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import {
  ThumbsUp,
  ThumbsDown,
  Bell,
  ShieldOff,
  RotateCcw,
  AlertTriangle,
  Search,
} from 'lucide-react'
import {
  getUserDatapoints,
  revokeAdmin,
  resetUserData,
  resetAllUsersData,
} from '#/lib/admin-server'
import type { AdminUserRow, UserDatapoints } from '#/lib/admin-server'
import {
  summarizeUsers,
  signupsByDay,
  filterUsers,
  sortUsers,
} from '#/lib/admin/users-view'
import type { AccessFilter, SortKey } from '#/lib/admin/users-view'
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

  // Analytics view controls (all client-side, live): a search box, an access
  // filter, and a sort key. Default sort is newest-first by signup date.
  const [query, setQuery] = useState('')
  const [access, setAccess] = useState<AccessFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('newest')

  // Totals + the 30-day signups chart are derived from the FULL row set (not the
  // filtered view) so the headline numbers describe the whole product, not the
  // current search. `now` is read once per render and passed in (the helpers are
  // pure + take it as an argument) so totals stay stable across a render.
  const now = Date.now()
  const summary = useMemo(() => summarizeUsers(users, now), [users, now])
  const chart = useMemo(() => signupsByDay(users, now, 30), [users, now])

  // The list the operator actually sees: filtered by email + access, then sorted.
  const visible = useMemo(
    () => sortUsers(filterUsers(users, { query, access }), sortKey),
    [users, query, access, sortKey],
  )

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
    <div className="space-y-6">
      {/* Analytics: totals + the signups-over-time chart describe the whole
          product (derived from the full row set, not the filtered view). */}
      <UsersAnalytics summary={summary} chart={chart} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {/* Users */}
        <div className="min-w-0 space-y-2">
          {/* Filter + sort controls. Live, client-side; they narrow the list only,
            never the headline totals above. */}
          <div className="flex flex-col gap-2 pb-1 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by email…"
                aria-label="Filter users by email"
                className="border-border bg-background focus-visible:ring-ring w-full rounded-lg border py-2 pr-3 pl-8 text-sm outline-none focus-visible:ring-2"
              />
            </div>
            <select
              value={access}
              onChange={(e) => setAccess(e.target.value as AccessFilter)}
              aria-label="Filter by access"
              className="border-border bg-background rounded-lg border px-2 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="onboarded">Onboarded</option>
              <option value="not-onboarded">Not onboarded</option>
              <option value="admins">Admins</option>
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sort users"
              className="border-border bg-background rounded-lg border px-2 py-2 text-sm"
            >
              <option value="newest">Newest</option>
              <option value="email">Email A–Z</option>
              <option value="swipes">Most swipes</option>
            </select>
          </div>
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
              This wipes EVERY user&apos;s household data (swipes, plans,
              shopping lists, staples, push) and forces them all to re-onboard.
              Accounts stay signed in. Tap again to confirm.
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
          {visible.map((u) => {
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
          {visible.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {users.length === 0
                ? 'No users yet.'
                : 'No users match the filter.'}
            </p>
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
    </div>
  )
}

/**
 * The analytics header: a row of small stat cards (totals) plus a compact,
 * dependency-free inline-SVG chart of accounts created per day over the last
 * ~30 days. On-brand (forest-green bars, mustard "today" accent) and small;
 * degrades to a friendly note when there is not enough signup data yet.
 */
function UsersAnalytics({
  summary,
  chart,
}: {
  summary: ReturnType<typeof summarizeUsers>
  chart: ReturnType<typeof signupsByDay>
}) {
  const stats: Array<{ label: string; value: number }> = [
    { label: 'Accounts', value: summary.total },
    { label: 'Onboarded', value: summary.onboarded },
    { label: 'Admins', value: summary.admins },
    { label: 'Swipes', value: summary.swipes },
    { label: 'New this week', value: summary.newThisWeek },
  ]
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="border-border bg-card rounded-lg border px-3 py-2.5"
          >
            <div className="text-xl font-semibold tabular-nums">{s.value}</div>
            <div className="text-muted-foreground text-xs">{s.label}</div>
          </div>
        ))}
      </div>
      {/* Signups over time */}
      <div className="border-border bg-card rounded-lg border px-4 py-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Sign-ups</h3>
          <span className="text-muted-foreground text-xs">last 30 days</span>
        </div>
        <SignupsChart chart={chart} />
      </div>
    </div>
  )
}

/**
 * Inline-SVG bar chart of daily signups (no chart lib — none is installed). Bars
 * are forest green (the brand --primary), today's bar is mustard (--accent) so
 * the most recent day reads at a glance. The viewBox scales to the container
 * width; an all-zero window shows a "not enough data yet" note instead.
 */
function SignupsChart({ chart }: { chart: ReturnType<typeof signupsByDay> }) {
  const max = chart.reduce((m, d) => Math.max(m, d.count), 0)
  if (max === 0) {
    return (
      <p className="text-muted-foreground mt-3 text-xs">
        Not enough sign-up data yet.
      </p>
    )
  }
  const W = 300
  const H = 64
  const n = chart.length
  const gap = 1.5
  const barW = (W - gap * (n - 1)) / n
  const total = chart.reduce((sum, d) => sum + d.count, 0)
  return (
    <div className="mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`Sign-ups per day over the last ${n} days, ${total} total`}
        preserveAspectRatio="none"
      >
        {chart.map((d, i) => {
          // At least 2px tall for any non-zero day so a single signup is visible.
          const h = d.count === 0 ? 0 : Math.max(2, (d.count / max) * H)
          const isToday = i === n - 1
          return (
            <rect
              key={d.date}
              x={i * (barW + gap)}
              y={H - h}
              width={barW}
              height={h}
              rx={0.75}
              className={isToday ? 'fill-accent' : 'fill-primary'}
            >
              <title>{`${d.date}: ${d.count} sign-up${d.count === 1 ? '' : 's'}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
        <span>{chart[0]?.date.slice(5)}</span>
        <span>today</span>
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
