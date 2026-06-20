import { createServerFn } from '@tanstack/react-start'
import type { MealRating } from './meal-feedback'

/**
 * Read-only loader for the FOCUSED rate-this-meal view (#214).
 *
 * The rate-meal push deep-links to /rate/$planId/$day. That route needs just one
 * day's dinner (image, title, prep/kcal) plus the household's existing rating for
 * it, scoped to the signed-in household. This is a small, dedicated read so the
 * focused view stays cheap (it does NOT load the whole week / alternative ranking
 * that loadWeek does).
 *
 * Stale handling: a plan/day that no longer resolves to a home-cooked dinner for
 * this household (old plan, an eating-out day, a renamed day) returns
 * `{ stale: true }` so the route can show a graceful "this meal is no longer in
 * your week" instead of a 500. Reads only; never writes.
 *
 * Server-only: every server-only module is dynamically imported inside the handler
 * so none of it leaks into the client bundle (the week-server / swap-server pattern).
 */

/** The single dinner the focused rate view renders, plus its current rating. */
export interface RateMealView {
  stale: false
  /** The plan (meal_plan) this dinner belongs to, echoed back for the write. */
  planId: string
  /** The day label this dinner sits on (Monday first), echoed for the header. */
  day: string
  /** The recipe id, the key the feedback write is scoped to. */
  recipeId: string
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
  /** The household's saved rating for this dinner (null = not rated yet). */
  rating: MealRating
  /** The household's saved note for this dinner, if any. */
  note: string | null
}

/** Returned when the plan/day no longer names a rateable dinner for the household. */
export interface RateMealStale {
  stale: true
}

export type RateMealResult = RateMealView | RateMealStale

/**
 * Pure stale-vs-rateable decision for a resolved day, pulled out so the branching
 * is unit-testable without the Start server/DB chain. A day is rateable only when
 * it exists in the plan, is not an eating-out day, and points at a recipe.
 */
export function isRateableDay(
  day:
    | { recipeRef?: string; type?: 'home' | 'busy' | 'out' }
    | null
    | undefined,
): boolean {
  if (!day) return false
  if (day.type === 'out') return false
  return Boolean(day.recipeRef)
}

export const loadRateMeal = createServerFn({ method: 'GET' })
  .validator((data: { planId: string; day: string }) => data)
  .handler(async ({ data }): Promise<RateMealResult> => {
    if (!data.planId || !data.day) return { stale: true }

    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipe, mealPlan, mealFeedback } =
      await import('../db/schema')
    const { eq, and } = await import('drizzle-orm')
    const db = await getDb()

    const householdRows = await db
      .select({ id: household.id })
      .from(household)
      .where(eq(household.ownerId, user.id))
      .limit(1)
    const hh = householdRows[0]
    if (!hh) throw new Error('No household, onboard first')

    // The plan must belong to this household: a stranger's plan id can never be
    // read. A missing plan is treated as stale (the week moved on), not a 500.
    const planRows = await db
      .select({ id: mealPlan.id, plan: mealPlan.plan })
      .from(mealPlan)
      .where(and(eq(mealPlan.id, data.planId), eq(mealPlan.householdId, hh.id)))
      .limit(1)
    const plan = planRows[0]
    if (!plan) return { stale: true }

    const dayEntry = plan.plan.days.find((d) => d.day === data.day)
    if (!isRateableDay(dayEntry) || !dayEntry?.recipeRef) {
      return { stale: true }
    }
    const recipeId = dayEntry.recipeRef

    const recipeRows = await db
      .select({
        title: recipe.title,
        cuisine: recipe.cuisine,
        prepMinutes: recipe.prepMinutes,
        calories: recipe.calories,
        protein: recipe.protein,
        raw: recipe.raw,
      })
      .from(recipe)
      .where(eq(recipe.id, recipeId))
      .limit(1)
    const r = recipeRows[0]
    // The plan names a recipe that no longer surfaces in the catalogue. Treat as
    // stale rather than rendering a blank card.
    if (!r) return { stale: true }

    const raw = (r.raw as { imageUrl?: string | null } | null) ?? null

    const feedbackRows = await db
      .select({ rating: mealFeedback.rating, note: mealFeedback.note })
      .from(mealFeedback)
      .where(
        and(
          eq(mealFeedback.householdId, hh.id),
          eq(mealFeedback.recipeId, recipeId),
          eq(mealFeedback.mealPlanId, data.planId),
        ),
      )
      .limit(1)
    const fb = feedbackRows[0]
    const rating: MealRating =
      fb?.rating === 'up' || fb?.rating === 'down' ? fb.rating : null

    return {
      stale: false,
      planId: plan.id,
      day: dayEntry.day,
      recipeId,
      meal: r.title,
      cuisine: r.cuisine ?? null,
      prepMinutes: r.prepMinutes ?? null,
      calories: r.calories ?? null,
      protein: r.protein ?? null,
      imageUrl: raw?.imageUrl ?? null,
      rating,
      note: rating ? (fb?.note ?? null) : null,
    }
  })
