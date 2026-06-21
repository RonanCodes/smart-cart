import { createServerFn } from '@tanstack/react-start'

export interface ApplySimilarSwapRequest {
  /** The plan id to edit (the current week). */
  planId: string
  /** The day to replace, e.g. "Tuesday". */
  day: string
  /** The similar recipe the user picked (a neighbour from getSimilarRecipes). */
  recipeId: string
}

export interface ApplySimilarSwapResponse {
  /** The new meal_plan revision id (a fresh row; the old one is kept). */
  planId: string
}

/**
 * Write a chosen "similar" recipe into one day of the signed-in household's week.
 *
 * The user opened a day on the week view, looked at its nearest-neighbour swaps
 * (getSimilarRecipes, #31), and picked one. This persists that pick: it loads the
 * plan, looks up the chosen recipe's title (so the denormalised `meal` label stays
 * correct), applies the pure edit, and writes a NEW meal_plan row (a revision; we
 * never overwrite the old week, mirroring replan-server). The plan and the recipe
 * are both validated against the household, so a stranger's plan id or a recipe id
 * outside the catalogue is rejected.
 *
 * Server-only: every server-only module is dynamically imported inside the handler
 * so none of it leaks into the client bundle (the week-server / replan-server
 * pattern). Reuses the similarity + planning logic elsewhere; this only writes the
 * already-chosen neighbour.
 */
export const applySimilarSwapToPlan = createServerFn({ method: 'POST' })
  .validator((data: ApplySimilarSwapRequest) => data)
  .handler(async ({ data }): Promise<ApplySimilarSwapResponse> => {
    if (!data.recipeId) throw new Error('recipeId required')
    if (!data.day) throw new Error('day required')

    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipe, mealPlan, recipeSwipe } =
      await import('../db/schema')
    const { eq, and } = await import('drizzle-orm')
    const { applySimilarSwap, planHasDay } =
      await import('./swap/apply-similar-swap')
    const { ensureDistinctSwap } = await import('./swap/ensure-distinct-swap')
    const { topNForDay } = await import('./planner')
    const { recordPickDataPoint } = await import('./swap/pick-to-data-point')
    const db = await getDb()

    const householdRows = await db
      .select({ id: household.id, profile: household.profile })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = householdRows[0]
    if (!hh) throw new Error('No household, onboard first')

    const planRows = await db
      .select({
        id: mealPlan.id,
        weekStart: mealPlan.weekStart,
        plan: mealPlan.plan,
      })
      .from(mealPlan)
      .where(and(eq(mealPlan.id, data.planId), eq(mealPlan.householdId, hh.id)))
      .limit(1)
    const current = planRows[0]
    if (!current) throw new Error('Plan not found')

    if (!planHasDay(current.plan.days, data.day)) {
      throw new Error('Day not in plan')
    }

    // The chosen recipe must exist in the catalogue; its title denormalises into
    // the plan's `meal` label so the week view stays consistent without a join.
    const recipeRows = await db
      .select({ id: recipe.id, title: recipe.title })
      .from(recipe)
      .where(eq(recipe.id, data.recipeId))
      .limit(1)
    const chosen = recipeRows[0]
    if (!chosen) throw new Error('Recipe not found')

    // A swap must ALWAYS move the day to a DIFFERENT recipe (#256). Normally the
    // chosen recipe already differs (the similar list drops the query recipe, the
    // per-day alternatives exclude the current pick), so this is a no-op fast path.
    // Only when the chosen recipe collides with the day's current dish do we resolve
    // the next-best DISTINCT candidate, using the SAME store filter + taste ranking
    // the week view uses (topNForDay), and only keep the current dish if there is
    // genuinely no other recipe to swap in (a degenerate one-recipe catalogue).
    const targetDay = current.plan.days.find((d) => d.day === data.day)
    const currentRecipeId = targetDay?.recipeRef ?? ''
    const otherDayRecipeIds = current.plan.days
      .filter((d) => d.day !== data.day && d.recipeRef)
      .map((d) => d.recipeRef as string)

    let resolvedId = chosen.id
    let resolvedTitle = chosen.title

    if (chosen.id === currentRecipeId) {
      const { hasImage } = await import('../db/recipe-filters')
      const catalogueRows = await db
        .select({
          id: recipe.id,
          title: recipe.title,
          cuisine: recipe.cuisine,
          category: recipe.category,
          dietaryTags: recipe.dietaryTags,
          ingredients: recipe.ingredients,
          calories: recipe.calories,
          protein: recipe.protein,
          prepMinutes: recipe.prepMinutes,
          mealType: recipe.mealType,
        })
        .from(recipe)
        // Only swap in servable (imaged) recipes, mirroring the week view.
        .where(hasImage)

      const catalogue = catalogueRows.map((r) => ({
        id: r.id,
        title: r.title,
        cuisine: r.cuisine,
        category: r.category,
        dietaryTags: r.dietaryTags,
        ingredients: r.ingredients.map((i) => ({ name: i.name })),
        calories: r.calories,
        protein: r.protein,
        prepMinutes: r.prepMinutes,
        mealType: r.mealType,
      }))

      const swipeRows = await db
        .select({
          recipeId: recipeSwipe.recipeId,
          direction: recipeSwipe.direction,
        })
        .from(recipeSwipe)
        .where(eq(recipeSwipe.householdId, hh.id))
      const swipes = swipeRows
        .filter((s) => s.direction === 'like' || s.direction === 'dislike')
        .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

      // Same hard filter + preference ranking as the week, excluding the current
      // pick and every other day's recipe so the fallback never duplicates a day.
      const ranked = topNForDay(catalogue, hh.profile, swipes, {
        excludeRecipeId: currentRecipeId || null,
        weekRecipeIds: otherDayRecipeIds,
        n: catalogue.length,
      })

      const { recipeId } = ensureDistinctSwap({
        chosenId: chosen.id,
        currentRecipeId,
        rankedCandidateIds: ranked.map((r) => r.id),
        avoidIds: otherDayRecipeIds,
      })

      resolvedId = recipeId
      const resolved = catalogue.find((r) => r.id === recipeId)
      // Fall back to the chosen title only in the degenerate same-id case.
      resolvedTitle = resolved?.title ?? chosen.title
    }

    const nextDays = applySimilarSwap(current.plan.days, data.day, {
      id: resolvedId,
      title: resolvedTitle,
    })

    // Persist a new revision. We keep the old row so a swap is reversible, exactly
    // as replan-server does.
    const newId = crypto.randomUUID()
    await db.insert(mealPlan).values({
      id: newId,
      householdId: hh.id,
      weekStart: current.weekStart,
      plan: {
        days: nextDays,
        shoppingList: current.plan.shoppingList,
      },
      status: 'draft',
    })

    // Record the pick as a recommender data point: a 'like' recipe_swipe row for
    // the chosen recipe, scoped to the household, so future plans lean toward what
    // this household actually picks. Best-effort and idempotent: it must never
    // break the swap itself, and picking the same recipe twice must not
    // double-count. The recommender reads these rows by `direction` only (see
    // planner-core / replan-server / week-server), so no migration is needed.
    try {
      await recordPickDataPoint(
        {
          hasSwipe: async (r) => {
            const existing = await db
              .select({ id: recipeSwipe.id })
              .from(recipeSwipe)
              .where(
                and(
                  eq(recipeSwipe.householdId, r.householdId),
                  eq(recipeSwipe.recipeId, r.recipeId),
                  eq(recipeSwipe.direction, r.direction),
                ),
              )
              .limit(1)
            return Boolean(existing[0])
          },
          insertSwipe: async (r) => {
            await db.insert(recipeSwipe).values({
              id: r.id,
              householdId: r.householdId,
              recipeId: r.recipeId,
              direction: r.direction,
              round: r.round,
            })
          },
        },
        { householdId: hh.id, chosenRecipeId: resolvedId },
        () => crypto.randomUUID(),
      )
    } catch (err) {
      // Never let taste-recording break the swap; the new plan revision is the
      // load-bearing result and is already persisted above.
      console.error('failed to record swap data point', err)
    }

    return { planId: newId }
  })
