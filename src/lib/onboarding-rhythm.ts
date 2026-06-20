/**
 * Pure helpers for the onboarding "default weekly rhythm" capture.
 *
 * A household's cook-days (which weekdays they usually cook a dinner) are stored
 * on `household.profile.cookDays` as an array of day indices, 0=Mon .. 6=Sun.
 * The planner later reads this to decide which days get a planned dinner by
 * default; the rest are 'Out'. No cook-days picked means "cook every day", so
 * we default an empty selection to all 7.
 */

/** Day indices: 0=Mon, 1=Tue, ... 6=Sun. */
export const DAY_LABELS = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const

export const ALL_DAYS: ReadonlyArray<number> = [0, 1, 2, 3, 4, 5, 6]

/**
 * Normalize a raw cook-day selection into the canonical stored form:
 * - drop anything outside 0..6 and non-integers
 * - dedupe
 * - sort ascending
 * - empty selection -> all 7 days (the "cook every day" default rhythm)
 */
export function normalizeCookDays(days: ReadonlyArray<number>): Array<number> {
  const valid = days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  const unique = Array.from(new Set(valid)).sort((a, b) => a - b)
  return unique.length > 0 ? unique : [...ALL_DAYS]
}

/**
 * Clamp a household-size stepper value to a sane non-negative integer.
 * Adults floor at 1 (a household has at least one cook); children floor at 0.
 */
export function clampHouseholdCount(
  value: number,
  min: number,
  max = 12,
): number {
  if (!Number.isFinite(value)) return min
  const i = Math.round(value)
  if (i < min) return min
  if (i > max) return max
  return i
}
