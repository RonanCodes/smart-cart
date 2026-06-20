/**
 * Auto-heal a stored week plan on load.
 *
 * Plans generated before the #161 AH/Jumbo + image filter can reference old
 * foodcom / themealdb recipes that are no longer servable (e.g. they render with
 * no image, like 'Bread Pudding with Jack Daniels Sauce'). New plans + the per-day
 * alternatives already only draw from servable recipes (source IN ('ah','jumbo')
 * with an image, the `hasImage` predicate). This repairs the gap for plans already
 * in the table: when a week loads, any day whose recipe is no longer servable is
 * transparently swapped for a servable alternative and the healed week is persisted
 * as a new revision so the repair sticks.
 *
 * Pure: no DB, no Worker bindings. The caller (week-server) loads the servable id
 * set + supplies a per-day alternative picker (the planner's topNForDay over the
 * already-loaded servable catalogue), then persists the result only when something
 * changed. Kept here so it unit-tests against plain objects.
 */

/** One day in the stored plan shape (meal_plan.plan.days). */
export interface HealPlanDay {
  day: string
  meal: string
  recipeRef?: string
  type?: 'home' | 'busy' | 'out'
}

/** The servable replacement chosen for a day: id + title (for the denormalised meal label). */
export interface HealReplacement {
  id: string
  title: string
}

/**
 * Pick a servable replacement for one non-servable day.
 *
 * Receives the day being healed and the set of recipe ids already in use across
 * the week (every day's current recipe plus any already-healed picks), so the
 * picker can honour the no-repeat rule. Returns the chosen servable recipe, or
 * `null` when no servable alternative is available (the day is then left as-is so
 * the caller never writes an empty meal over a real one).
 */
export type PickServableAlternative = (
  day: HealPlanDay,
  excludeIds: ReadonlySet<string>,
) => HealReplacement | null

export interface HealWeekPlanResult {
  /** The healed days (a fresh array; the input is never mutated). */
  days: Array<HealPlanDay>
  /** True when at least one day was replaced, so the caller knows to persist. */
  changed: boolean
}

/**
 * Walk the week and replace any day whose recipe is not servable with a servable
 * alternative.
 *
 * Rules:
 *  - A day with no recipe ('out' or an empty `recipeRef`) is never touched.
 *  - A day whose `recipeRef` IS in `servableIds` is passed through unchanged.
 *  - A day whose `recipeRef` is NOT servable is replaced with the picker's choice.
 *    The replacement is excluded from later days (no-repeat), and the broken id is
 *    dropped from the in-use set so a later day can reuse that freed slot if the
 *    picker ever wanted to (it never offers a non-servable id anyway).
 *  - When the picker returns null (no servable alternative left), the day is left
 *    as-is. It stays broken rather than blanked, and `changed` is not flipped by it.
 *
 * `changed` is true iff at least one day was actually replaced, so an all-servable
 * plan returns `changed: false` and the caller skips the write (no new revision, no
 * behaviour change).
 */
export function healWeekPlan(
  days: ReadonlyArray<HealPlanDay>,
  servableIds: ReadonlySet<string>,
  pick: PickServableAlternative,
): HealWeekPlanResult {
  // Every recipe currently placed in the week is in use (so the picker never
  // returns a duplicate). Healed picks are added; healed-away broken ids are removed.
  const inUse = new Set<string>(
    days.map((d) => d.recipeRef).filter((r): r is string => !!r),
  )

  let changed = false

  const healed = days.map((d) => {
    const ref = d.recipeRef
    // No recipe to heal (skipped / out day), or already servable: pass through.
    if (!ref || servableIds.has(ref)) {
      return { day: d.day, meal: d.meal, recipeRef: d.recipeRef, type: d.type }
    }

    // The day's recipe is no longer servable. The broken id is not a real
    // exclusion (it cannot be re-picked anyway), so free it before asking.
    inUse.delete(ref)
    const replacement = pick(d, inUse)
    if (!replacement) {
      // No servable alternative available: leave the day untouched rather than
      // blank it. Re-add the broken id so a later day still treats it as used.
      inUse.add(ref)
      return { day: d.day, meal: d.meal, recipeRef: d.recipeRef, type: d.type }
    }

    inUse.add(replacement.id)
    changed = true
    return {
      day: d.day,
      meal: replacement.title,
      recipeRef: replacement.id,
      type: d.type,
    }
  })

  return { days: healed, changed }
}
