import type { PlannedWeek } from '../planner/types'

/**
 * One day's change between the week before a replan and the week after.
 *
 * `removedTitle` is the dish that was on the day before the replan; `addedTitle`
 * is the dish that replaced it. Either can be empty: an "eating out" replan
 * clears a day (addedTitle is ''), and filling a previously-empty day leaves
 * removedTitle ''. The banner renders these as "<old> -> <new>".
 */
export interface PlanDayChange {
  /** The day label (Monday first), e.g. "Wednesday". */
  day: string
  /** The dish title before the replan, or '' if the day was empty. */
  removedTitle: string
  /** The dish title after the replan, or '' if the day is now empty (out). */
  addedTitle: string
}

/**
 * Compute the per-day diff between the week before a replan and the week after.
 *
 * Pure: it compares the two weeks day-by-day (matched on the day label) and
 * returns one `PlanDayChange` for every day whose dish title actually changed.
 * Days that are unchanged, and days present in only one of the two weeks, are
 * skipped. The order follows the `before` week (Monday first), so the list reads
 * in calendar order regardless of how the engine reshuffled picks.
 *
 * This is the detail behind the agent's summary line ("Removed fish from 3
 * dinners."): the summary is the headline, this is the expandable per-day list.
 */
export function buildPlanDiff(
  before: PlannedWeek,
  after: PlannedWeek,
): Array<PlanDayChange> {
  const afterByDay = new Map(after.days.map((d) => [d.day, d.meal]))
  const changes: Array<PlanDayChange> = []
  for (const day of before.days) {
    if (!afterByDay.has(day.day)) continue
    const removedTitle = day.meal
    const addedTitle = afterByDay.get(day.day) ?? ''
    if (removedTitle === addedTitle) continue
    changes.push({ day: day.day, removedTitle, addedTitle })
  }
  return changes
}
