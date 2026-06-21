import type { DayType } from './types'

/**
 * The minimal day shape `inferSkipDays` reads. Looser than `PlannedDay` so it
 * accepts both freshly planned days and stored plan rows (where `recipeRef` is
 * optional). A day is "skipped" when it has no recipe.
 */
export interface SkipDayInput {
  recipeRef?: string
  type?: DayType
}

/**
 * Pure skip-day inference (#week-nav). Learns which weekdays a household
 * consistently skips (eating-out / cleared days) from their PAST plans, so a
 * freshly generated week can default those same days to skipped instead of
 * planning a dinner the household will not cook.
 *
 * A day is "skipped" in a stored plan when it has no recipe (an 'out' day, or
 * any day the user cleared): empty `recipeRef`. We look at the most recent
 * `lookback` plans (newest first, so the caller passes plans newest-first) and,
 * per weekday position (0 = Monday .. 6 = Sunday), mark it skipped only when it
 * was skipped in a strict MAJORITY of the plans that actually cover that day.
 *
 * Kept conservative on purpose: with too little history (fewer than `minPlans`)
 * we infer nothing, so a brand-new household never gets days silently removed.
 * Pure + deterministic, so it is unit-testable with no DB.
 *
 * @param pastPlans  The household's recent plans, NEWEST FIRST. Each is the
 *                   stored `plan.days` array (Monday-first, 7 entries).
 * @param opts.lookback  How many recent plans to weigh. Default 4.
 * @param opts.minPlans  Minimum plans required before inferring anything.
 *                       Default 2 (need at least a small pattern, not one week).
 * @returns A set of weekday indices (0 = Monday .. 6 = Sunday) the household
 *          consistently skips.
 */
export function inferSkipDays(
  pastPlans: Array<Array<SkipDayInput>>,
  opts: { lookback?: number; minPlans?: number } = {},
): Set<number> {
  const lookback = opts.lookback ?? 4
  const minPlans = opts.minPlans ?? 2

  const recent = pastPlans.slice(0, lookback)
  if (recent.length < minPlans) return new Set()

  const skip = new Set<number>()
  for (let i = 0; i < 7; i++) {
    let covered = 0
    let skipped = 0
    for (const plan of recent) {
      const day = plan[i]
      if (!day) continue // plan shorter than 7 days: weekday not covered.
      covered++
      const isSkipped = !day.recipeRef || day.type === 'out'
      if (isSkipped) skipped++
    }
    // Strict majority of the plans that actually covered this weekday.
    if (covered > 0 && skipped * 2 > covered) skip.add(i)
  }
  return skip
}

/**
 * Turn an inferred skip-day set into a `dayTypes` override the planner consumes
 * (#week-nav). Position i (0 = Monday .. 6 = Sunday) is 'out' when skipped, else
 * undefined so `generateWeek` falls back to the household's normal rhythm for
 * that day (cook-days profile / every-day-home). Returns undefined when nothing
 * is skipped, so the planner sees no override at all (strict no-op).
 */
export function skipDaysToOverride(
  skip: Set<number>,
  days = 7,
): Array<DayType | undefined> | undefined {
  if (skip.size === 0) return undefined
  return Array.from({ length: days }, (_, i) =>
    skip.has(i % 7) ? ('out' as const) : undefined,
  )
}
