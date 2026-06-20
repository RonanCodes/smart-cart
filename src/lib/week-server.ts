import { createServerFn } from '@tanstack/react-start'

/**
 * One ready alternative for a day, denormalised with the same card detail the
 * day itself shows, so the edit sheet (tap a day -> pick from ~5 alternatives)
 * can render appetizing cards with no extra round-trip.
 */
export interface DayAlternative {
  /** The alternative recipe id, written into the plan when picked. */
  recipeRef: string
  /** The recipe's title. */
  meal: string
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
  /**
   * ~5 ready alternatives for this day, pre-ranked for the household and already
   * excluding the current pick + the rest of the week (no dupes). Shipped with
   * the week so the edit sheet opens instantly. Empty for a skipped ('out') day.
   */
  alternatives: Array<DayAlternative>
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
    const { household, recipe, recipeSwipe, mealPlan } =
      await import('../db/schema')
    const { eq, and, inArray } = await import('drizzle-orm')
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

    const detailRows = ids.length
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

    const detail = new Map(detailRows.map((r) => [r.id, r]))

    // Load the full candidate catalogue + the household's swipes once, then rank
    // the top-N alternatives per day in-process. The ranking is fast (it is the
    // same one that built this week), so shipping the alternatives with the week
    // makes the edit sheet open instantly with no extra round-trip. Only recipes
    // with an image surface as cards (same rule as the week + similar swap).
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

    // Every recipe placed in the week is off-limits as an alternative, so picking
    // one can never create a duplicate. Includes each day's current pick.
    const weekRecipeIds = ids

    const days: Array<WeekDayView> = current.plan.days.map((d) => {
      const r = d.recipeRef ? detail.get(d.recipeRef) : undefined
      const raw = (r?.raw as { imageUrl?: string | null } | null) ?? null

      const alts = topNForDay(catalogue, hh.profile, swipes, {
        excludeRecipeId: d.recipeRef || null,
        weekRecipeIds,
        dayType: d.type ?? 'home',
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

      return {
        day: d.day,
        meal: d.meal,
        recipeRef: d.recipeRef ?? '',
        cuisine: r?.cuisine ?? null,
        prepMinutes: r?.prepMinutes ?? null,
        calories: r?.calories ?? null,
        protein: r?.protein ?? null,
        imageUrl: raw?.imageUrl ?? null,
        alternatives,
      }
    })

    return { planId: current.id, weekStart: current.weekStart, days }
  })
