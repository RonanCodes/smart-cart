import { useState } from 'react'
import { ThumbsUp, ThumbsDown, Bell, ShieldOff } from 'lucide-react'
import { getUserDatapoints, revokeAdmin } from '#/lib/admin-server'
import type { AdminUserRow, UserDatapoints } from '#/lib/admin-server'
import { sendRateMealPush } from '#/lib/push-server'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'

/**
 * Short human label for a person's access state, factoring onboarding in: an
 * onboarded real user reads 'Onboarded', a granted/approved-but-never-onboarded
 * person reads 'Approved user', and a bare user row with no grant reads 'Not
 * onboarded'. The separate Admin badge already covers admins.
 */
function accessTag(u: AdminUserRow): string {
  if (u.access === 'admin') return 'Admin'
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
export function UsersPanel({ users }: { users: Array<AdminUserRow> }) {
  const [detail, setDetail] = useState<UserDatapoints | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
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

  async function open(userId: string) {
    setLoadingId(userId)
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
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 pb-1">
          <Button
            size="sm"
            variant="outline"
            disabled={pushBusy !== null}
            onClick={() => void sendPush('all')}
          >
            <Bell className="h-4 w-4" aria-hidden />
            {pushBusy === 'all' ? 'Sending…' : 'Send rate-meal push to all'}
          </Button>
        </div>
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
                    <Badge variant="outline" className="shrink-0">
                      {accessTag(u)}
                    </Badge>
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
            </div>
          )
        })}
        {users.length === 0 && (
          <p className="text-muted-foreground text-sm">No users yet.</p>
        )}
      </div>

      {/* Detail */}
      <div className="border-border min-h-[60vh] rounded-xl border p-5">
        {loadingId && !detail ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : detail ? (
          <div className="space-y-5">
            <div>
              <h2 className="font-semibold">{detail.email}</h2>
              <p className="text-muted-foreground text-sm">
                What we think they like
              </p>
            </div>
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
        ) : (
          <p className="text-muted-foreground text-sm">
            Select a user on the left.
          </p>
        )}
      </div>
    </div>
  )
}
