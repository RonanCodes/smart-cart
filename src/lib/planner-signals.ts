import { foldRealFeedback } from './recsys/feedback-fold'
import { loadPlannerPenalties } from './memory/memory-server'
import type { PlannerSwipe, SoftPenalties } from './planner/types'

/**
 * The taste signals the planner + replan engine learn from, loaded once and shared
 * by every data-layer entry point (plan generation, replan, week read). This is
 * where the feedback loop actually CLOSES:
 *
 *   - post-meal thumbs (`meal_feedback`) are folded on top of the onboarding
 *     swipes, so a 👍/👎 after dinner shifts next week the same way a swipe does
 *     (last signal per recipe wins — see `foldRealFeedback`), and
 *   - learned memory + recent week history become the planner's soft penalties
 *     (variety / dislikes / recently-served), so "not pizza every week" actually
 *     down-weights pizza in proportion to how often it was just served.
 *
 * Server-only (reaches D1); always dynamically imported inside server handlers so
 * the binding never leaks into the client bundle.
 */
export interface PlannerSignals {
  /** Onboarding swipes with post-meal feedback folded on top. */
  swipes: Array<PlannerSwipe>
  /** Memory- + history-derived soft penalties (empty leaves ranking unchanged). */
  penalties: SoftPenalties
}

/** Fold a household's post-meal feedback onto its onboarding swipes. */
export async function foldFeedbackIntoSwipes(
  householdId: string,
  onboardingSwipes: Array<PlannerSwipe>,
): Promise<Array<PlannerSwipe>> {
  const { getDb } = await import('../db/client')
  const { mealFeedback } = await import('../db/schema')
  const { eq, asc } = await import('drizzle-orm')
  const db = await getDb()

  const rows = await db
    .select({
      recipeId: mealFeedback.recipeId,
      rating: mealFeedback.rating,
    })
    .from(mealFeedback)
    .where(eq(mealFeedback.householdId, householdId))
    .orderBy(asc(mealFeedback.createdAt))

  const signals = rows
    .filter(
      (r): r is { recipeId: string; rating: string } => r.recipeId != null,
    )
    .map((r) => ({ recipeId: r.recipeId, rating: r.rating }))

  return foldRealFeedback(onboardingSwipes, signals)
}

/**
 * Load both signals at once: folded swipes + planner penalties. Callers pass the
 * onboarding swipes they already read; we fold feedback on top and add penalties.
 */
export async function loadPlannerSignals(
  householdId: string,
  onboardingSwipes: Array<PlannerSwipe>,
): Promise<PlannerSignals> {
  const [swipes, penalties] = await Promise.all([
    foldFeedbackIntoSwipes(householdId, onboardingSwipes),
    loadPlannerPenalties(householdId),
  ])
  return { swipes, penalties }
}
