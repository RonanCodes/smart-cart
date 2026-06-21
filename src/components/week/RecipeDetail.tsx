import { useEffect, useState } from 'react'
import { Clock, Users, Loader2, ListChecks, ChefHat } from 'lucide-react'
import { getRecipeDetail } from '#/lib/recipe-detail-server'
import type { RecipeDetailResult } from '#/lib/recipe-detail-server'

interface RecipeDetailProps {
  /** The recipe to fetch the detail for (the day's recipeRef). */
  recipeId: string
  /**
   * Gate the fetch. The card lives inside the edit sheet, so it only fetches
   * once that sheet is open (lazy, on demand) rather than on every week render.
   */
  active: boolean
}

/**
 * The actual recipe for the day's dish: its ingredients (quantity + name) and
 * the written-out cooking steps. This is the primary thing a user wants when
 * they tap a dish on the week, so it renders at the TOP of the edit sheet, above
 * the swap alternatives and the "Souso knows" facts card.
 *
 * Lazy + on demand: it fetches only when `active` (the sheet is open), mirroring
 * the RecipeFacts pattern so the week itself never carries the per-dish detail.
 * Sections hide themselves when empty (a recipe with ingredients but no steps
 * shows just the ingredients) so a partial recipe never renders an empty heading.
 *
 * Imports only the createServerFn (the handler body is stripped from the client
 * bundle) + the result type, so nothing server-only leaks here.
 */
export function RecipeDetail({ recipeId, active }: RecipeDetailProps) {
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<RecipeDetailResult | null>(null)
  // Remember which recipe we loaded so re-opening the same day doesn't refetch.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!active || !recipeId) return
    if (loadedFor === recipeId) return

    let cancelled = false
    setLoading(true)
    setDetail(null)
    void getRecipeDetail({ data: { recipeId } })
      .then((res) => {
        if (cancelled) return
        setDetail(res)
        setLoadedFor(recipeId)
      })
      .catch(() => {
        // Degrade to hidden: a failed fetch leaves detail null, card stays gone.
        if (!cancelled)
          setDetail({
            ingredients: [],
            steps: [],
            prepMinutes: null,
            servings: null,
            amountsEstimated: false,
          })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [active, recipeId, loadedFor])

  if (active && loading && loadedFor !== recipeId) {
    return (
      <div className="text-muted-foreground mt-1 mb-4 flex items-center gap-2 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading the recipe...
      </div>
    )
  }

  if (!detail) return null

  const hasIngredients = detail.ingredients.length > 0
  const hasSteps = detail.steps.length > 0
  // Nothing to show (an old row with neither): hide rather than render an empty box.
  if (!hasIngredients && !hasSteps) return null

  return (
    <section className="mt-1 mb-4 space-y-4">
      {(detail.prepMinutes != null || detail.servings != null) && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {detail.prepMinutes != null && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {detail.prepMinutes} min
            </span>
          )}
          {detail.servings != null && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {detail.servings} {detail.servings === 1 ? 'serving' : 'servings'}
            </span>
          )}
        </div>
      )}

      {hasIngredients && (
        <div className="border-border bg-card rounded-xl border p-3">
          <h3 className="text-foreground mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <ListChecks className="text-primary h-4 w-4" aria-hidden />
            Ingredients
            {detail.amountsEstimated && (
              <span className="text-muted-foreground ml-1 text-xs font-normal">
                (approx amounts)
              </span>
            )}
          </h3>
          <ul className="divide-border/60 divide-y">
            {detail.ingredients.map((ing, i) => (
              <li
                key={`${ing.name}-${i}`}
                className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
              >
                <span className="text-foreground">{ing.name}</span>
                {ing.amount && (
                  <span className="text-muted-foreground flex-shrink-0 text-right text-xs">
                    {ing.amount}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasSteps && (
        <div className="border-border bg-card rounded-xl border p-3">
          <h3 className="text-foreground mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <ChefHat className="text-primary h-4 w-4" aria-hidden />
            How to make it
          </h3>
          <ol className="space-y-2.5">
            {detail.steps.map((step, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-snug">
                <span className="bg-secondary text-foreground/80 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                  {i + 1}
                </span>
                <span className="text-foreground/90 pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
