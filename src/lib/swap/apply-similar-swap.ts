/**
 * Pure plan edit for a "swap for similar" pick.
 *
 * The week view (#12) lets the user swap a day for the next-best by preference.
 * This is the sibling edit: the user picked a SPECIFIC similar recipe (a
 * similarity neighbour) and we drop it into one day. The replacement keeps the rest of
 * the week untouched, so the edit is local and reversible (the server writes it as
 * a new meal_plan revision, never an overwrite).
 *
 * Pure: no DB, no Worker bindings, so it unit-tests against a plain plan object.
 * The server fn (swap-server.ts) loads the rows, calls this, then persists.
 */

/** One day in the stored plan shape (meal_plan.plan.days). */
export interface PlanDay {
  day: string
  meal: string
  recipeRef?: string
}

/** The recipe the user picked from the similar list, narrowed to what we store. */
export interface ChosenRecipe {
  id: string
  title: string
}

/**
 * Return a new days array with `day`'s dinner replaced by `chosen`. The input is
 * not mutated (a fresh array of fresh day objects), so the caller can keep the old
 * week for the revision history. Days other than the target are copied through
 * unchanged. If the named day is not in the plan, the array comes back equal to the
 * input (the server treats that as "no change").
 */
export function applySimilarSwap(
  days: ReadonlyArray<PlanDay>,
  day: string,
  chosen: ChosenRecipe,
): Array<PlanDay> {
  return days.map((d) =>
    d.day === day
      ? { day: d.day, meal: chosen.title, recipeRef: chosen.id }
      : { day: d.day, meal: d.meal, recipeRef: d.recipeRef },
  )
}

/** Whether the named day exists in the plan (so the server can reject a bad day). */
export function planHasDay(days: ReadonlyArray<PlanDay>, day: string): boolean {
  return days.some((d) => d.day === day)
}
