import { useState } from 'react'
import { ThumbsUp, ThumbsDown, ChevronDown, ArrowRight } from 'lucide-react'
import { explainUser } from '#/lib/admin-server'
import type {
  AdminUserRow,
  UserExplanation,
  RecipeWhy,
} from '#/lib/admin-server'
import { Badge } from '#/components/ui/badge'
import { cn } from '#/lib/utils'

/**
 * The "Why these recipes" explainability view. Pick a user, then read the chain:
 *
 *   data points (their swipes)  ->  inferred preferences  ->  recommendations
 *
 * rendered as three connected columns. Each recommendation expands to the signals
 * that placed it (loved cuisine / loved ingredient / disliked hits), reusing the
 * recommender's explain() output shaped server-side. Desktop-first; admin-gated by
 * the route guard. No chart library — plain flex columns + an arrow between them.
 */
export function WhyPanel({ users }: { users: Array<AdminUserRow> }) {
  const [explanation, setExplanation] = useState<UserExplanation | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  async function open(userId: string) {
    setSelectedId(userId)
    setLoadingId(userId)
    setExplanation(await explainUser({ data: { userId } }))
    setLoadingId(null)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_2.4fr]">
      {/* User picker */}
      <div className="min-w-0 space-y-2">
        <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
          Pick a user
        </p>
        {/*
          Only real user rows have swipes to explain; people who are merely
          admin/approved-by-env with no `user` row (userId null) have nothing to
          graph, so they are filtered out of the Why picker.
        */}
        {users
          .filter((u): u is typeof u & { userId: string } => u.userId !== null)
          .map((u) => (
            <button
              key={u.userId}
              onClick={() => open(u.userId)}
              className={cn(
                'border-border flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition',
                selectedId === u.userId
                  ? 'border-primary bg-secondary'
                  : 'hover:bg-secondary',
              )}
            >
              <span className="min-w-0 truncate text-sm font-medium">
                {u.email}
              </span>
              <span className="text-muted-foreground ml-3 shrink-0 text-xs">
                {u.swipes} swipes
              </span>
            </button>
          ))}
        {users.length === 0 && (
          <p className="text-muted-foreground text-sm">No users yet.</p>
        )}
      </div>

      {/* The graph */}
      <div className="border-border min-h-[60vh] min-w-0 rounded-xl border p-5">
        {loadingId ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : explanation ? (
          <WhyGraph explanation={explanation} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Pick a user to see why their recipes were chosen.
          </p>
        )}
      </div>
    </div>
  )
}

function WhyGraph({ explanation }: { explanation: UserExplanation }) {
  const { datapoints, preferences, recommendations } = explanation
  const likes = datapoints.filter((d) => d.like).length
  const dislikes = datapoints.length - likes

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold">{explanation.email}</h2>
        <p className="text-muted-foreground text-sm">
          {datapoints.length} data points feed the inferred tastes that drive{' '}
          {recommendations.length} recommendations.
        </p>
      </div>

      {/* Three connected columns */}
      <div className="grid items-start gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1.2fr]">
        {/* Column 1: data points */}
        <Column
          title="Data points"
          subtitle={`${likes} liked · ${dislikes} disliked`}
        >
          <div className="max-h-[42vh] space-y-1 overflow-auto pr-1">
            {datapoints.map((d, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 border-b py-1.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {d.like ? (
                    <ThumbsUp className="text-primary h-4 w-4 shrink-0" />
                  ) : (
                    <ThumbsDown className="h-4 w-4 shrink-0 text-red-500" />
                  )}
                  <span className="truncate">{d.recipeTitle}</span>
                </span>
                <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                  {d.cuisine ?? ''}
                </span>
              </div>
            ))}
            {datapoints.length === 0 && (
              <p className="text-muted-foreground text-sm">No swipes yet.</p>
            )}
          </div>
        </Column>

        <Edge />

        {/* Column 2: inferred preferences */}
        <Column title="Inferred preferences" subtitle="loved / disliked">
          <div className="flex flex-wrap gap-2">
            {preferences.lovedCuisines.map((c) => (
              <Badge key={`lc-${c.token}`} variant="primary">
                {c.token} ({c.support})
              </Badge>
            ))}
            {preferences.lovedIngredients.map((t) => (
              <Badge key={`li-${t.token}`} variant="accent">
                {t.token} ({t.support})
              </Badge>
            ))}
            {preferences.dislikedCuisines.map((c) => (
              <Badge key={`dc-${c}`} variant="outline">
                no {c}
              </Badge>
            ))}
            {preferences.dislikedIngredients.map((t) => (
              <Badge key={`di-${t}`} variant="outline">
                no {t}
              </Badge>
            ))}
            {preferences.lovedCuisines.length === 0 &&
              preferences.lovedIngredients.length === 0 &&
              preferences.dislikedCuisines.length === 0 &&
              preferences.dislikedIngredients.length === 0 && (
                <span className="text-muted-foreground text-sm">
                  Nothing inferred yet.
                </span>
              )}
          </div>
        </Column>

        <Edge />

        {/* Column 3: recommendations */}
        <Column
          title="Recommendations"
          subtitle={`top ${recommendations.length}`}
        >
          <div className="space-y-1">
            {recommendations.map((r, i) => (
              <RecommendationRow key={r.id} rank={i + 1} why={r} />
            ))}
            {recommendations.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No recommendations yet.
              </p>
            )}
          </div>
        </Column>
      </div>
    </div>
  )
}

function Column({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    // min-w-0 lets the grid track shrink so the recommendation titles inside
    // can truncate instead of forcing the whole graph wider than its column.
    <div className="min-w-0">
      <div className="mb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && (
          <p className="text-muted-foreground text-xs">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  )
}

/** The connecting arrow between two columns (hidden on narrow screens). */
function Edge() {
  return (
    <div className="hidden items-center justify-center self-center lg:flex">
      <ArrowRight className="text-muted-foreground h-5 w-5" />
    </div>
  )
}

function RecommendationRow({ rank, why }: { rank: number; why: RecipeWhy }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b">
      <button
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-secondary/60 flex w-full items-center justify-between gap-2 rounded py-1.5 text-left text-sm transition"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-muted-foreground w-5 shrink-0 text-xs">
            {rank}.
          </span>
          <span className="truncate">{why.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {why.cuisine && (
            <span className="text-muted-foreground text-xs">{why.cuisine}</span>
          )}
          <ChevronDown
            className={cn(
              'text-muted-foreground h-4 w-4 transition',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>
      {open && (
        <ul className="text-muted-foreground space-y-0.5 pb-2 pl-7 text-xs">
          {why.signals.map((s, i) => (
            <li
              key={i}
              className={cn(
                s.contribution > 0 ? 'text-primary' : 'text-red-500',
              )}
            >
              {s.label}
            </li>
          ))}
          {why.signals.length === 0 && (
            <li>No strong signals — surfaced as a neutral pick.</li>
          )}
        </ul>
      )}
    </div>
  )
}
