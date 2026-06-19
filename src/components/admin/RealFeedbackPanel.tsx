import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { compareRealFeedback } from '#/lib/admin-server'
import type {
  RankingView,
  RealFeedbackComparison,
  RealFeedbackHousehold,
} from '#/lib/admin-server'
import { Badge } from '#/components/ui/badge'
import { cn } from '#/lib/utils'

/**
 * Real-feedback fold-in view. Pick a REAL household (one that has left post-meal
 * thumbs), then flip "include real feedback" to see its ranking + inferred taste
 * WITH vs WITHOUT that feedback folded on top of the onboarding swipes. The
 * synthetic benchmark (other tab) stays the baseline; this is the live-data,
 * on-top-of view. Reuses the same Badge primitive as the Users tab.
 */
export function RealFeedbackPanel({
  households,
}: {
  households: Array<RealFeedbackHousehold>
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [comparison, setComparison] = useState<RealFeedbackComparison | null>(
    null,
  )
  const [includeFeedback, setIncludeFeedback] = useState(true)
  const [loading, setLoading] = useState(false)

  async function select(householdId: string) {
    setSelectedId(householdId)
    setLoading(true)
    setComparison(await compareRealFeedback({ data: { householdId } }))
    setLoading(false)
  }

  const active: RankingView | null = comparison
    ? includeFeedback
      ? comparison.withFeedback
      : comparison.withoutFeedback
    : null

  if (households.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No real households yet. A household shows up here once it has left
        post-meal feedback (thumbs up/down). Synthetic seeded users have no real
        feedback, so they live in the Benchmark tab instead.
      </p>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
      {/* Real households */}
      <div className="space-y-2">
        <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
          Households with real feedback
        </p>
        {households.map((h) => (
          <button
            key={h.householdId}
            onClick={() => select(h.householdId)}
            className={cn(
              'border-border flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition',
              selectedId === h.householdId
                ? 'border-primary bg-secondary'
                : 'hover:bg-secondary',
            )}
          >
            <span className="min-w-0 truncate text-sm font-medium">
              {h.email}
            </span>
            <span className="text-muted-foreground ml-3 shrink-0 text-xs">
              {h.swipes} swipes · {h.feedback} feedback
            </span>
          </button>
        ))}
      </div>

      {/* Comparison */}
      <div className="border-border min-h-[60vh] rounded-xl border p-5">
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : comparison && active ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{comparison.email}</h2>
                <p className="text-muted-foreground text-sm">
                  Ranking {includeFeedback ? 'with' : 'without'} real feedback
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeFeedback}
                  onChange={(e) => setIncludeFeedback(e.target.checked)}
                  className="accent-primary h-4 w-4"
                />
                Include real feedback
              </label>
            </div>

            {/* What folding changes */}
            <div className="bg-secondary/50 rounded-lg p-3 text-sm">
              <p className="text-muted-foreground">
                {comparison.fold.onboarding} onboarding swipes
                <ArrowRight className="mx-1.5 inline h-3.5 w-3.5" />
                {comparison.fold.feedbackSignals} real-feedback signals fold in
                {comparison.fold.netNew > 0 &&
                  ` (+${comparison.fold.netNew} new recipe${
                    comparison.fold.netNew === 1 ? '' : 's'
                  })`}
                {comparison.fold.overrides > 0 &&
                  `, ${comparison.fold.overrides} override${
                    comparison.fold.overrides === 1 ? '' : 's'
                  }`}
                . Observation set: {comparison.fold.onboarding}
                {' → '}
                {comparison.fold.total}.
              </p>
              {comparison.fold.feedbackSignals === 0 && (
                <p className="text-muted-foreground mt-1 text-xs">
                  No usable up/down feedback yet — toggle has no effect.
                </p>
              )}
            </div>

            {/* Inferred taste */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Inferred taste</h3>
              <div className="flex flex-wrap gap-2">
                {active.taste.lovedCuisines.map((c) => (
                  <Badge key={`lc-${c.cuisine}`} variant="primary">
                    {c.cuisine}
                  </Badge>
                ))}
                {active.taste.lovedIngredients.map((t) => (
                  <Badge key={`li-${t}`} variant="primary">
                    {t}
                  </Badge>
                ))}
                {active.taste.dislikedCuisines.map((c) => (
                  <Badge key={`dc-${c}`} variant="outline">
                    no {c}
                  </Badge>
                ))}
                {active.taste.dislikedIngredients.map((t) => (
                  <Badge key={`di-${t}`} variant="outline">
                    no {t}
                  </Badge>
                ))}
                {active.taste.lovedCuisines.length === 0 &&
                  active.taste.lovedIngredients.length === 0 && (
                    <span className="text-muted-foreground text-sm">
                      Nothing inferred yet.
                    </span>
                  )}
              </div>
            </div>

            {/* Top recommendations */}
            <div>
              <h3 className="mb-2 text-sm font-semibold">
                Top {active.topRecipes.length} recommendations
              </h3>
              <div className="space-y-1">
                {active.topRecipes.map((r, i) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between border-b py-1.5 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="text-muted-foreground w-5 shrink-0 text-xs">
                        {i + 1}.
                      </span>
                      <span className="truncate">{r.title}</span>
                    </span>
                    <span className="text-muted-foreground ml-2 shrink-0 text-xs">
                      {r.cuisine ?? ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Select a household on the left to compare its ranking with vs
            without real feedback.
          </p>
        )}
      </div>
    </div>
  )
}
