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
 *
 * `targetWeekStart` (a YYYY-MM-DD Monday) stamps the plan to a specific week; it
 * defaults to the current week's Monday. Week navigation (Part A) passes a
 * future Monday to generate next week's plan on demand.
 *
 * Smarter generation (#week-nav): when the household ALREADY has a most-recent
 * plan, the new week is generated with that plan's dinners excluded from the
 * pool (variety, so next week is not a clone) and with the household's
 * consistently-skipped weekdays defaulted to 'out' (skip-day learning). Both are
 * strict no-ops for a fresh household with no prior plan, so the first week (and
 * the recsys benchmark fixture) is byte-for-byte unchanged.
 */
export async function generatePlanForHousehold(
  householdId: string,
  targetWeekStart?: string,
): Promise<GeneratePlanResult> {
  const { getDb } = await import('../db/client')
  const { household, recipe, recipeSwipe, mealPlan, mealFeedback } =
    await import('../db/schema')
  const { generateWeek } = await import('./planner/planner')
  const { inferSkipDays, resolveSkipDays, skipDaysToOverride } =
    await import('./planner/skip-days')
  const { hasImage } = await import('../db/recipe-filters')
  const { foldRealFeedback } = await import('./recsys/feedback-fold')
  const { eq, asc, desc } = await import('drizzle-orm')
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

  const onboardingSwipes = swipeRows
    .filter((s) => s.direction === 'like' || s.direction === 'dislike')
    .map((s) => ({ recipeId: s.recipeId, like: s.direction === 'like' }))

  // Close the learning loop (#126): fold post-meal thumbs onto the onboarding
  // swipes. A thumbs-down on a cooked dish is a stronger, more recent signal
  // than a swipe, so it overrides per recipe (foldRealFeedback, last-wins). Read
  // oldest-first so the most recent rating wins. With no feedback this is the
  // identity, so a fresh household's week is unchanged.
  const feedbackRows = await db
    .select({ recipeId: mealFeedback.recipeId, rating: mealFeedback.rating })
    .from(mealFeedback)
    .where(eq(mealFeedback.householdId, hh.id))
    .orderBy(asc(mealFeedback.createdAt))
  const feedback = feedbackRows
    .filter(
      (f): f is { recipeId: string; rating: string } => f.recipeId != null,
    )
    .map((f) => ({ recipeId: f.recipeId, rating: f.rating }))
  const swipes = foldRealFeedback(onboardingSwipes, feedback)

  // Memory-derived soft penalties (variety / dislikes / recently-served) on top
  // of the folded swipes, so learned preferences ("not pizza every week") shape
  // the new week. Empty for a household with no memory -> ranking unchanged.
  const { loadPlannerPenalties } = await import('./memory/memory-server')
  const penalties = await loadPlannerPenalties(hh.id)

  // Smarter future-week generation (#week-nav). Look at the household's recent
  // plans (newest first). With NO prior plan this stays empty -> both knobs are
  // no-ops and the week is generated exactly as before (fresh household + the
  // benchmark fixture unchanged).
  const recentPlanRows = await db
    .select({ weekStart: mealPlan.weekStart, plan: mealPlan.plan })
    .from(mealPlan)
    .where(eq(mealPlan.householdId, hh.id))
    .orderBy(desc(mealPlan.createdAt))
    .limit(8)

  // Variety: exclude the MOST-RECENT plan's dinners so the new week brings
  // different meals instead of cloning last week. Hard filters (diet/allergies)
  // still apply on top inside the planner.
  const excludeRecipeIds = (recentPlanRows[0]?.plan.days ?? [])
    .map((d) => d.recipeRef)
    .filter((r): r is string => !!r)

  // Skip-day learning: infer the weekdays the household consistently skips from
  // their recent plans, and default those days to 'out' in the new week. Only
  // the days array (Monday-first) is needed; the helper is pure + conservative
  // (needs a small history before it infers anything).
  //
  // A MANUAL skipDays override on the profile (#data-points) WINS over the
  // inference: when the household has set their own skip-days in the profile
  // editor we honour those verbatim; otherwise we fall back to the inferred set.
  // Both are strict no-ops for a fresh household (no override + no history ->
  // empty set -> no dayTypes override), so the first week + benchmark fixture
  // stay byte-for-byte unchanged.
  const inferred = inferSkipDays(recentPlanRows.map((p) => p.plan.days))
  const skip = resolveSkipDays(hh.profile.skipDays, inferred)
  const dayTypes = skipDaysToOverride(skip)

  const week = generateWeek(recipes, hh.profile, swipes, {
    excludeRecipeIds,
    dayTypes,
    penalties,
  })

  const weekStart = targetWeekStart ?? mondayOf(new Date())
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
