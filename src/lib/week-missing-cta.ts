import { missingCount } from './week-loader-guards'

export type CountMissingForPlan = (planId: string) => Promise<unknown>

/**
 * Refetch how many of the week's ingredients are not yet on the saved list.
 * The week CTA reads this after swaps/replans adopt a new plan revision without
 * re-running the route loader (which would flash the full-page skeleton).
 */
export async function missingFromListForPlan(
  planId: string,
  countMissing: CountMissingForPlan,
): Promise<number> {
  return missingCount(await countMissing(planId))
}
