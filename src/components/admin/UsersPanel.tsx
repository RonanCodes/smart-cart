import { useState } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { getUserDatapoints } from '#/lib/admin-server'
import type { AdminUserRow, UserDatapoints } from '#/lib/admin-server'
import { Badge } from '#/components/ui/badge'

/**
 * The synthetic-users list + per-user data-points drill-down. Extracted verbatim
 * from the original /admin route so BOTH the Users tab and the Benchmark tab render
 * the exact same view (the benchmark tab embeds it for the "view synthetic users +
 * data points" requirement) without rebuilding it.
 */
export function UsersPanel({ users }: { users: Array<AdminUserRow> }) {
  const [detail, setDetail] = useState<UserDatapoints | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function open(userId: string) {
    setLoadingId(userId)
    setDetail(await getUserDatapoints({ data: { userId } }))
    setLoadingId(null)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      {/* Users */}
      <div className="space-y-2">
        {users.map((u) => (
          <button
            key={u.userId}
            onClick={() => open(u.userId)}
            className="border-border hover:bg-secondary flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{u.email}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {u.badges.slice(0, 3).map((b) => (
                  <span key={b.label} className="text-xs">
                    {b.emoji} {b.label}
                  </span>
                ))}
                {u.badges.length === 0 && (
                  <span className="text-muted-foreground text-xs">
                    not onboarded
                  </span>
                )}
              </div>
            </div>
            <span className="text-muted-foreground ml-3 shrink-0 text-xs">
              {u.swipes} swipes
            </span>
          </button>
        ))}
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
