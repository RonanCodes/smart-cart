import { createServerFn } from '@tanstack/react-start'
import type { DayAlternative } from './week-server'

export interface AddMealAlternativesRequest {
  /** The plan id to add a meal into (the current week). */
  planId: string
  /** The day to fill, e.g. "Tuesday". */
  day: string
}

export interface AddMealAlternativesResponse {
  /** ~5 ready recipes the user can drop into the day, pre-ranked for the household. */
  alternatives: Array<DayAlternative>
}

/**
 * List the recipes a user can ADD to an eating-out / empty day on the week view.
 *
 * The week view ships alternatives with every day so the edit sheet opens
 * instantly (week-server). But a day whose type is 'out' deliberately carries NO
 * alternatives (topNForDay returns [] for an 'out' day, because there is nothing
 * to swap). Issue #175 wants those days to stop being dead ends: a user whose
 * plans changed should be able to drop a dinner in. This fetches the per-day
 * alternatives while treating the day as a normal home day, so an 'out' or empty
 * day gets the same five appetizing, household-ranked picks every other day shows.
 *
 * It reads the same catalogue + swipes the week view ranks from and reuses the
 * planner's topNForDay as-is (no planner changes); the chosen recipe is persisted
 * through the existing swap path (applySimilarSwapToPlan), so this fn only reads.
 *
 * Server-only: every server-only module is dynamically imported inside the handler
 * so none of it leaks into the client bundle (the week-server / swap-server
 * pattern). The plan is validated against the signed-in household, so a stranger's
 * plan id is rejected.
 */
export const addMealAlternatives = createServerFn({ method: 'GET' })
  .validator((data: AddMealAlternativesRequest) => data)
  .handler(async ({ data }): Promise<AddMealAlternativesResponse> => {
    if (!data.day) throw new Error('day required')

    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipe, recipeSwipe, mealPlan } =
      await import('../db/schema')
    const { eq, and } = await import('drizzle-orm')
    const { hasImage } = await import('../db/recipe-filters')
    const { topNForDay } = await import('./planner/planner')
    const db = await getDb()

    const householdRows = await db
      .select({ id: household.id, profile: household.profile })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = householdRows[0]
    if (!hh) throw new Error('No household, onboard first')

    const planRows = await db
      .select({ id: mealPlan.id, plan: mealPlan.plan })
      .from(mealPlan)
      .where(and(eq(mealPlan.id, data.planId), eq(mealPlan.householdId, hh.id)))
      .limit(1)
    const current = planRows[0]
    if (!current) throw new Error('Plan not found')
    if (!current.plan.days.some((d) => d.day === data.day)) {
      throw new Error('Day not in plan')
    }

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
        raw: recipe.raw,
      })
      .from(recipe)
      .where(hasImage)

    const swipeRows = await db
      .select({
        recipeId: recipeSwipe.recipeId,
        direction: recipeSwipe.direction,
      })
      .from(recipeSwipe)
      .where(eq(recipeSwipe.householdId, hh.id))

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

    const imageById = new Map(
      catalogueRows.map((r) => [
        r.id,
        ((r.raw as { imageUrl?: string | null } | null) ?? null)?.imageUrl ??
          null,
      ]),
    )

    const swipes = swipeRows
      .filter((s) => s.direction === 'like' || s.direction === 'dislike')
      .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

    // Every recipe already placed in the week is off-limits, so adding one can
    // never create a duplicate (same rule as the per-day alternatives + similar
    // swap). Force the day to 'home' so an eating-out day still gets picks.
    const weekRecipeIds = current.plan.days
      .map((d) => d.recipeRef)
      .filter((r): r is string => !!r)

    const target = current.plan.days.find((d) => d.day === data.day)
    const alts = topNForDay(catalogue, hh.profile, swipes, {
      excludeRecipeId: target?.recipeRef || null,
      weekRecipeIds,
      dayType: 'home',
      n: 5,
    })

    const alternatives: Array<DayAlternative> = alts.map((a) => ({
      recipeRef: a.id,
      meal: a.title,
      cuisine: a.cuisine ?? null,
      prepMinutes: a.prepMinutes ?? null,
      calories: a.calories ?? null,
      protein: a.protein ?? null,
      imageUrl: imageById.get(a.id) ?? null,
    }))

    return { alternatives }
  })
