import type { WeekView, WeekDayView } from './week-server'

/**
 * The day fields a card actually renders. If none of these changed between the
 * old day and the new one, the card shows the same thing, so we keep the OLD
 * object reference and React.memo skips re-rendering that card. `alternatives`
 * is deliberately excluded from the comparison: it is sheet-only data that
 * re-derives on every `loadWeek`, so comparing it would mark every day "changed"
 * on every replan and defeat the whole point. The edit sheet reads alternatives
 * off the live `week` object at open time, not off a memoised card, so keeping
 * the old reference (with its slightly older alternatives) is harmless — the
 * next open still sees fresh data because `editing` is looked up from `week`.
 */
function sameRenderedDay(a: WeekDayView, b: WeekDayView): boolean {
  return (
    a.day === b.day &&
    a.recipeRef === b.recipeRef &&
    a.meal === b.meal &&
    a.cuisine === b.cuisine &&
    a.prepMinutes === b.prepMinutes &&
    a.calories === b.calories &&
    a.protein === b.protein &&
    a.imageUrl === b.imageUrl
  )
}

/**
 * Merge a freshly loaded week into the current one preserving object IDENTITY
 * for unchanged days. A replan typically touches one or two days; replacing the
 * whole `days` array (as a naive `setWeek(next)` does) hands every DayCard new
 * prop references, so React re-renders all seven and the layout can jitter.
 *
 * This keeps the exact same `WeekDayView` reference for any day whose rendered
 * fields are unchanged, and only swaps in the new object for days that actually
 * changed. With `DayCard` wrapped in `React.memo` and stable per-day callbacks,
 * unchanged cards skip rendering entirely, so a Friday swap can't move Thursday
 * or Saturday on screen.
 *
 * Added / removed days (the day set differs) are handled by following `next`'s
 * day list: a day present only in `next` is taken as-is; a day only in `prev`
 * drops out. Pure and side-effect free, so it unit-tests cleanly.
 */
export function mergeWeekPreservingIdentity(
  prev: WeekView,
  next: WeekView,
): WeekView {
  const prevByDay = new Map(prev.days.map((d) => [d.day, d]))

  let anyDayReplaced = false
  const days = next.days.map((nd) => {
    const pd = prevByDay.get(nd.day)
    if (pd && sameRenderedDay(pd, nd)) return pd
    anyDayReplaced = true
    return nd
  })

  // If the day set and every rendered day are identical, hand back the SAME
  // `days` array reference too (lengths differ ⇒ definitely changed).
  const sameDayCount = days.length === prev.days.length
  const daysUnchanged = sameDayCount && !anyDayReplaced

  return {
    ...next,
    days: daysUnchanged ? prev.days : days,
  }
}
