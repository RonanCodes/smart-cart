/**
 * User-count milestones for the admin celebration email.
 *
 * We celebrate when Souso crosses 150 home cooks, then again every 25 after
 * that (150, 175, 200, 225, ...). Because account creation increments the total
 * by exactly one, the milestone fires once per crossing: the test is simply
 * "is THIS the count that lands on a milestone?".
 */

/** The first milestone we celebrate. */
export const FIRST_MILESTONE = 150
/** The step between milestones after the first. */
export const MILESTONE_STEP = 25

/**
 * True when `count` is exactly a milestone: 150, or 150 + a multiple of 25
 * (175, 200, 225, ...). False for anything below 150 and for in-between counts.
 * Since the user count goes up one at a time, this fires once per milestone.
 */
export function isUserCountMilestone(count: number): boolean {
  if (!Number.isInteger(count)) return false
  if (count < FIRST_MILESTONE) return false
  return (count - FIRST_MILESTONE) % MILESTONE_STEP === 0
}
