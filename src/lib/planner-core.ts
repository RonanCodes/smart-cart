import type { GeneratePlanResult } from './planner-server'

/**
 * Server-only plan-generation core. This module is NEVER statically imported by
 * client code — both callers reach it via `await import('./planner-core')`
 * inside a server-fn handler. Keeping it out of the static client graph is what
 * stops its `cloudflare:workers` / DB imports leaking into the browser bundle
 * (the TanStack plugin only strips server-fn HANDLER bodies, not a plain
 * exported function reachable through a static import chain).
 *
 * It exists so the signed-in `generatePlan` server fn and form-onboarding's
 * `completeOnboarding` share one code path; the caller has already resolved the
 * household id (and thus the user).
 */

/** Monday (ISO) of the week containing `d`, as a YYYY-MM-DD string. */
function mondayOf(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  )
  const dow = date.getUTCDay() // 0 = Sunday
  const delta = dow === 0 ? -6 : 1 - dow
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

/**
 * Generate (or regenerate) a household's week and persist it as a meal_plan row.
 * Reads recipe + household.profile + the onboarding swipes, runs the pure
 * planner core, writes the plan, returns the stable plan id.
 *
 * Hard filters (diet + dislikes via the profile's allergy/diet gates) and soft
 * weights (goals) are applied inside generateWeek from the persisted profile.
 */
export async function generatePlanForHousehold(
  householdId: string,
): Promise<GeneratePlanResult> {
  const { getDb } = await import('../db/client')
  const { household, recipe, recipeSwipe, mealPlan } =
    await import('../db/schema')
  const { generateWeek } = await import('./planner/planner')
  const { hasImage } = await import('../db/recipe-filters')
  const { eq } = await import('drizzle-orm')
  const db = await getDb()

  const householdRows = await db
    .select({ id: household.id, profile: household.profile })
    .from(household)
    .where(eq(household.id, householdId))
    .limit(1)
  const hh = householdRows[0]
  if (!hh) throw new Error('No household, onboard first')

  const recipeRows = await db
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
    // Only plan recipes that have an image (no broken cards in the week view).
    .where(hasImage)

  const swipeRows = await db
    .select({
      recipeId: recipeSwipe.recipeId,
      direction: recipeSwipe.direction,
    })
    .from(recipeSwipe)
    .where(eq(recipeSwipe.householdId, hh.id))

  const recipes = recipeRows.map((r) => ({
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

  const swipes = swipeRows
    .filter((s) => s.direction === 'like' || s.direction === 'dislike')
    .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

  const week = generateWeek(recipes, hh.profile, swipes)

  const weekStart = mondayOf(new Date())
  const planId = crypto.randomUUID()
  await db.insert(mealPlan).values({
    id: planId,
    householdId: hh.id,
    weekStart,
    plan: {
      days: week.days.map((d) => ({
        day: d.day,
        meal: d.meal,
        recipeRef: d.recipeRef,
        type: d.type ?? 'home',
      })),
      shoppingList: [],
    },
    status: 'draft',
  })

  return { planId, weekStart, week }
}
