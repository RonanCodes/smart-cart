/**
 * Pure helpers for the scheduled rate-meal push (Part C). No DB, no Worker — so
 * the "does today have a non-skipped dinner?" decision is unit-testable in
 * isolation. The orchestration (DB reads, push sends) lives in the server-only
 * scheduled-nudges.ts which dynamic-imports the push send path.
 */

/** The day shape inside a stored meal_plan.plan.days. */
export interface PlanDay {
  day: string
  meal: string
  recipeRef?: string
  type?: 'home' | 'busy' | 'out'
}

/** Plan day labels, Monday-first, as the planner writes them. */
const DAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/**
 * The plan day for an Amsterdam day-of-week (0 = Sunday .. 6 = Saturday), or
 * null if the plan has no such labelled day. Maps the JS Sunday-0 convention to
 * the plan's Monday-first labels.
 */
export function planDayForDow(
  days: Array<PlanDay>,
  dow: number,
): PlanDay | null {
  // dow 0=Sun..6=Sat -> label index (Monday-first): Sunday is last.
  const labelIndex = dow === 0 ? 6 : dow - 1
  const label = DAY_LABELS[labelIndex]
  return days.find((d) => d.day === label) ?? null
}

/**
 * Does TODAY (the given Amsterdam day-of-week) have a NON-SKIPPED dinner in this
 * plan? True only when the day exists, is not an 'out' (eating-out) day, and has
 * a real recipeRef. Used to decide whether the 20:00 rate-meal push is worth
 * sending (no push on a night the household isn't cooking).
 */
export function todayHasCookedDinner(
  days: Array<PlanDay>,
  dow: number,
): boolean {
  const d = planDayForDow(days, dow)
  if (!d) return false
  if (d.type === 'out') return false
  return Boolean(d.recipeRef && d.recipeRef.trim() !== '')
}
