import { Leaf } from 'lucide-react'
import type { WasteSummary } from '#/lib/shopping'

/**
 * The food-waste story, collapsed to ONE quiet line (#178 de-noise).
 *
 * The old Shopping tab led with a stack of cards ("Less food waste this week",
 * "Used across meals", an estimated-waste meter) that buried the actual list.
 * This keeps the honest pitch but as a single muted sentence above the list:
 * how many ingredients get reused across the week, so nothing is left over.
 * Hidden entirely when there is nothing real to claim, so it never adds noise
 * to a one-recipe or top-up shop.
 */
export function WasteLine({
  waste,
  estimated = false,
}: {
  waste: WasteSummary
  /** When true, the amounts behind the count are inferred, so we say "approx" (#313). */
  estimated?: boolean
}) {
  if (!waste.hasSavings || waste.sharedIngredientCount === 0) return null

  const n = waste.sharedIngredientCount
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <Leaf className="text-primary/70 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {n} {n === 1 ? 'ingredient' : 'ingredients'} reused across your meals,
        nothing left over.
        {estimated && ' Amounts are approximate.'}
      </span>
    </p>
  )
}
