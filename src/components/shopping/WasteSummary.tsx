import { Leaf, Recycle } from 'lucide-react'
import type { WasteSummary as WasteSummaryData } from '#/lib/shopping'
import { wasteLevel } from '#/lib/shopping'

/**
 * The food-waste reduction summary header (slice #80, PRD #77 third pitch leg).
 *
 * Souso buys ingredients ONCE across the week and at the exact amount the
 * recipes use, so less food goes off in the drawer. This block makes that
 * explicit and honest at the top of the Shopping tab:
 *
 *   - 'X ingredients reused across your meals, nothing left over' (the shared
 *     count, the most concrete signal).
 *   - 'Exact amounts, no rounded packs' (the exact-amount count).
 *   - A coarse, clearly-labelled 'estimated waste avoided' level (low / good /
 *     great), never a fabricated gram count.
 *
 * Warm + food-forward: a soft amber card with a green leaf accent (green is the
 * accent here, not the dominant surface). Hidden entirely when there is nothing
 * to claim. Augments the existing list (#79); it does not replace it.
 */
export function WasteSummary({ waste }: { waste: WasteSummaryData }) {
  if (!waste.hasSavings) return null

  const level = wasteLevel(waste)
  const levelLabel = LEVEL_LABEL[level]
  const reused = waste.sharedIngredientCount
  const extraBuys = waste.reusedMealCoverage

  return (
    <section
      aria-labelledby="waste-heading"
      className="border-accent/30 bg-accent/5 space-y-3 rounded-[var(--radius-ios)] border p-4"
    >
      <div className="flex items-center gap-2">
        <span className="bg-primary/12 text-primary flex h-7 w-7 items-center justify-center rounded-full">
          <Leaf className="h-4 w-4" aria-hidden />
        </span>
        <h2 id="waste-heading" className="text-sm font-semibold tracking-tight">
          Less food waste this week
        </h2>
      </div>

      {reused > 0 && (
        <p className="text-foreground text-sm">
          <span className="font-semibold">
            {reused} {reused === 1 ? 'ingredient' : 'ingredients'}
          </span>{' '}
          reused across your meals, nothing left over
          {extraBuys > 0 && (
            <span className="text-muted-foreground">
              {' '}
              ({extraBuys} repeat {extraBuys === 1 ? 'buy' : 'buys'} avoided)
            </span>
          )}
          .
        </p>
      )}

      {waste.exactAmountCount > 0 && (
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <Recycle
            className="text-primary mt-0.5 h-4 w-4 shrink-0"
            aria-hidden
          />
          <span>
            Exact amounts on {waste.exactAmountCount} of {waste.totalItems}{' '}
            {waste.totalItems === 1 ? 'item' : 'items'}, so you buy what the
            recipes use, not a rounded pack.
          </span>
        </p>
      )}

      <div className="border-accent/20 flex items-center justify-between border-t pt-3">
        <span className="text-muted-foreground text-xs">
          Estimated waste avoided
        </span>
        <span className="text-foreground text-xs font-semibold">
          {levelLabel}{' '}
          <span className="text-muted-foreground font-normal">(estimate)</span>
        </span>
      </div>
    </section>
  )
}

/** Human words for each coarse bucket. Never a precise percentage. */
const LEVEL_LABEL: Record<ReturnType<typeof wasteLevel>, string> = {
  none: 'A little',
  some: 'Some',
  good: 'Good',
  great: 'Great',
}
