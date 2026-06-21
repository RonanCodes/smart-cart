import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getRecipeDetail } from '#/lib/recipe-detail-server'
import type { RecipeDetailResult } from '#/lib/recipe-detail-server'
import { ingredientSticker } from '#/lib/ingredient-sticker'

interface RecipeDetailProps {
  /** The recipe to fetch the detail for (the day's recipeRef). */
  recipeId: string
  /**
   * Gate the fetch. The card lives inside the recipe sheet, so it only fetches
   * once that sheet is open (lazy, on demand) rather than on every week render.
   */
  active: boolean
  /** kcal per serving from the week row, for the "Per serve" fact. */
  calories?: number | null
  /** grams of protein per serving from the week row, for the "Protein" fact. */
  protein?: number | null
}

/**
 * The actual recipe for the day's dish, styled as the Souso recipe card (the
 * `/design/recipe` prototype against real data): a 4-up facts strip, then an
 * Ingredients section where every item carries its own cut-out product sticker
 * + amount, then numbered Steps with big ghosted index numbers. This is the
 * primary thing a user wants when they tap a dish on the week, so it renders at
 * the TOP of the recipe sheet, above the swap action and the "Souso knows" card.
 *
 * Lazy + on demand: it fetches only when `active` (the sheet is open), mirroring
 * the RecipeFacts pattern so the week itself never carries the per-dish detail.
 * Sections hide themselves when empty (a recipe with ingredients but no steps
 * shows just the ingredients) so a partial recipe never renders an empty heading.
 *
 * Imports only the createServerFn (the handler body is stripped from the client
 * bundle) + the result type, so nothing server-only leaks here. The
 * ingredient-sticker map is a pure client helper (no server import).
 */
export function RecipeDetail({
  recipeId,
  active,
  calories,
  protein,
}: RecipeDetailProps) {
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

  // Facts strip: only the fields we actually have, so the grid never shows an
  // empty cell. Column count follows the real data (2..4 facts).
  const facts: Array<[label: string, value: string]> = []
  if (detail.prepMinutes != null) facts.push(['Time', `${detail.prepMinutes}m`])
  if (hasIngredients) facts.push(['Items', String(detail.ingredients.length)])
  if (calories != null) facts.push(['Per serve', `${calories}`])
  if (protein != null) facts.push(['Protein', `${protein}g`])

  return (
    <section className="mt-1 mb-2 space-y-6">
      {facts.length > 0 && (
        <div
          className="border-hairline grid gap-2 border-y py-3 text-center"
          style={{
            gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))`,
          }}
        >
          {facts.map(([k, v]) => (
            <div key={k}>
              <p className="text-muted-foreground text-[0.6rem] font-bold tracking-[0.12em] uppercase">
                {k}
              </p>
              <p className="mt-0.5 text-sm font-bold">{v}</p>
            </div>
          ))}
        </div>
      )}

      {hasIngredients && (
        <div>
          <h2
            className="text-lg font-bold"
            style={{ letterSpacing: '-0.02em' }}
          >
            Ingredients
            {detail.amountsEstimated && (
              <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                (approx amounts)
              </span>
            )}
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {detail.ingredients.map((ing, i) => {
              const sticker = ingredientSticker(ing.name)
              return (
                <div
                  key={`${ing.name}-${i}`}
                  className="border-border bg-card flex items-center gap-2.5 rounded-2xl border p-2 shadow-sm"
                >
                  <div className="bg-secondary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                    {sticker && (
                      <img
                        src={sticker}
                        alt=""
                        aria-hidden
                        className="souso-sticker h-8 w-8 object-contain"
                        style={{ transform: 'rotate(-3deg)' }}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.8rem] font-semibold">
                      {ing.name}
                    </p>
                    {ing.amount && (
                      <p className="text-muted-foreground text-[0.7rem]">
                        {ing.amount}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {hasSteps && (
        <div>
          <h2
            className="mb-1 text-lg font-bold"
            style={{ letterSpacing: '-0.02em' }}
          >
            Steps
          </h2>
          <div>
            {detail.steps.map((step, i) => (
              <div
                key={i}
                className="border-hairline flex gap-3 border-b py-3.5 last:border-b-0"
              >
                <span
                  className="text-foreground/15 leading-none font-extrabold"
                  style={{ fontSize: '1.6rem', letterSpacing: '-0.04em' }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <p className="text-foreground/80 pt-0.5 text-sm leading-relaxed">
                  {step}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
