import { createServerFn } from '@tanstack/react-start'

/**
 * One day's dinner in the week view, denormalised with the recipe detail the
 * cards render: title, cuisine, prep time, calories/protein when known, and the
 * image. A day the user is eating out has an empty `recipeRef` and no detail.
 */
export interface WeekDayView {
  /** Day label, Monday first. */
  day: string
  /** The chosen recipe's title (empty string when the day is skipped). */
  meal: string
  /** The chosen recipe id, the stable reference into the catalogue. */
  recipeRef: string
  /** Cuisine label, when the recipe has one. */
  cuisine: string | null
  /** Prep time in minutes, when known. */
  prepMinutes: number | null
  /** kcal per serving, when known. */
  calories: number | null
  /** grams of protein per serving, when known. */
  protein: number | null
  /** Hero image URL, when the source recipe carried one. */
  imageUrl: string | null
}

export interface WeekView {
  /** The stable meal_plan id this view was loaded from. */
  planId: string
  /** Monday of the planned week, ISO date string. */
  weekStart: string
  /** Seven dinners, Monday first. */
  days: Array<WeekDayView>
}

/**
 * Load a persisted week by plan id and enrich each day with the recipe detail the
 * cards need. Reads meal_plan (the stored week) + recipe (for the per-day detail).
 * The plan must belong to the signed-in household, so a stranger's plan id can
 * never be read.
 *
 * Server-only: every server-only module is dynamically imported inside the
 * handler so none of it leaks into the client bundle (the planner-server pattern).
 */
export const loadWeek = createServerFn({ method: 'GET' })
  .validator((data: { planId: string }) => data)
  .handler(async ({ data }): Promise<WeekView> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipe, mealPlan } = await import('../db/schema')
    const { eq, and, inArray } = await import('drizzle-orm')
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

    const ids = current.plan.days
      .map((d) => d.recipeRef)
      .filter((r): r is string => !!r)

    const recipeRows = ids.length
      ? await db
          .select({
            id: recipe.id,
            cuisine: recipe.cuisine,
            prepMinutes: recipe.prepMinutes,
            calories: recipe.calories,
            protein: recipe.protein,
            raw: recipe.raw,
          })
          .from(recipe)
          .where(inArray(recipe.id, ids))
      : []

    const detail = new Map(recipeRows.map((r) => [r.id, r]))

    const days: Array<WeekDayView> = current.plan.days.map((d) => {
      const r = d.recipeRef ? detail.get(d.recipeRef) : undefined
      const raw = (r?.raw as { imageUrl?: string | null } | null) ?? null
      return {
        day: d.day,
        meal: d.meal,
        recipeRef: d.recipeRef ?? '',
        cuisine: r?.cuisine ?? null,
        prepMinutes: r?.prepMinutes ?? null,
        calories: r?.calories ?? null,
        protein: r?.protein ?? null,
        imageUrl: raw?.imageUrl ?? null,
      }
    })

    return { planId: current.id, weekStart: current.weekStart, days }
  })
