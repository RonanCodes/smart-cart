/**
 * Pure plan edit for "remove / skip a dinner on a day we won't cook" (#255).
 *
 * The week view lets a household swap a day (apply-similar-swap.ts) or add a meal
 * to an empty day (#175). This is the third edit: clear a day entirely so the
 * household is NOT cooking that night. The day keeps its slot in the week (Monday
 * still renders, Sunday still renders) but loses its recipe, so the week shows the
 * empty "No dinner, Add one" state and the day drops out of the shopping list +
 * the cart automatically (every list derivation already ignores a day with no
 * `recipeRef`: shopping-server.deriveShoppingView, cart links downstream of it).
 *
 * Marking the day `type: 'out'` matches the existing eating-out concept the
 * planner already understands, so a cleared day reads identically to a day the
 * onboarding rhythm marked as eating-out: empty recipe, 'out' type, no card.
 *
 * Pure: no DB, no Worker bindings, so it unit-tests against a plain plan object.
 * The server fn (week-clear-server.ts) loads the rows, calls this, then persists a
 * new revision (never an overwrite, mirroring swap-server / replan-server).
 */

/**
 * One day in the stored plan shape (meal_plan.plan.days). Mirrors the schema's
 * `plan.days[]` entry, including the optional `type` an 'out' day carries.
 */
export interface PlanDay {
  day: string
  meal: string
  recipeRef?: string
  type?: 'home' | 'busy' | 'out'
}

/**
 * Return a new days array with `day` cleared: its recipe removed and the day
 * marked as eating-out ('out'). The input is not mutated (a fresh array of fresh
 * day objects) so the caller can keep the old week for the revision history. Days
 * other than the target are copied through unchanged, `type` preserved. If the
 * named day is not in the plan, the array comes back equal in shape to the input
 * (the server treats that as "no change").
 */
export function clearDay(
  days: ReadonlyArray<PlanDay>,
  day: string,
): Array<PlanDay> {
  return days.map((d) =>
    d.day === day
      ? { day: d.day, meal: '', recipeRef: '', type: 'out' as const }
      : { day: d.day, meal: d.meal, recipeRef: d.recipeRef, type: d.type },
  )
}

/** Whether the named day exists in the plan (so the server can reject a bad day). */
export function planHasDay(days: ReadonlyArray<PlanDay>, day: string): boolean {
  return days.some((d) => d.day === day)
}

/**
 * Whether a day is "active" (the household is cooking a dinner there): it carries
 * a non-empty recipe reference. A cleared / skipped / eating-out day is inactive.
 * This is the single predicate every downstream consumer (shopping list, cart)
 * uses to decide whether a day contributes ingredients, so the rule lives in one
 * place and is unit-testable.
 */
export function isDayActive(day: { recipeRef?: string }): boolean {
  return !!day.recipeRef
}

/**
 * The subset of days that contribute to the shopping list + cart: only active
 * days (a real recipe). Mirrors the `if (!d.recipeRef) continue` guard the
 * shopping derivation already applies, surfaced as a named helper so "exclude
 * skipped days" is one obvious call rather than an inline filter.
 */
export function activeDays<T extends { recipeRef?: string }>(
  days: ReadonlyArray<T>,
): Array<T> {
  return days.filter(isDayActive)
}
