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
    const { household, recipe, mealPlan } = await import('../db/schema')
    const { eq, and } = await import('drizzle-orm')
    const { applySimilarSwap, planHasDay } =
      await import('./swap/apply-similar-swap')
    const db = await getDb()

    const householdRows = await db
      .select({ id: household.id })
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

    const nextDays = applySimilarSwap(current.plan.days, data.day, {
      id: chosen.id,
      title: chosen.title,
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

    return { planId: newId }
  })
