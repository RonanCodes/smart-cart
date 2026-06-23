/** The first user-count milestone Souso celebrates. */
export const FIRST_MILESTONE = 150
/** The gap between milestones after the first one. */
export const MILESTONE_STEP = 25

/**
 * True when a total user count lands exactly on a celebration milestone: 150,
 * then every 25 after (175, 200, 225, 250, ...). Because signups raise the count
 * by one, each milestone value is hit exactly once, so a caller that checks the
 * fresh count after each new user fires the celebration once per milestone with
 * no extra bookkeeping.
 *
 * Pure and total: non-integer, zero, and negative counts are never milestones.
 */
export function isUserCountMilestone(count: number): boolean {
  if (!Number.isInteger(count)) return false
  if (count < FIRST_MILESTONE) return false
  return (count - FIRST_MILESTONE) % MILESTONE_STEP === 0
}
