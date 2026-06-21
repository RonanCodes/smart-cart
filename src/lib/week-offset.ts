/**
 * Pure week-offset math for the prev/next week navigation (Part A) and the
 * weekly-plan reminder deep-link (Part C). No DB, no Worker, no env — so it runs
 * identically in unit tests, the client (for the nav label + deep-link), and the
 * server fn. Mirrors the `mondayOf` helper in planner-core, kept pure here so the
 * client can compute the target week without pulling in any server-only module.
 */

/** Monday (ISO) of the week containing `d`, as a YYYY-MM-DD string (UTC). */
export function mondayOf(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  )
  const dow = date.getUTCDay() // 0 = Sunday
  const delta = dow === 0 ? -6 : 1 - dow
  date.setUTCDate(date.getUTCDate() + delta)
  return date.toISOString().slice(0, 10)
}

/** Parse a YYYY-MM-DD string to its [year, month, day] numbers. */
function ymd(date: string): [number, number, number] {
  const parts = date.split('-').map(Number)
  return [parts[0] ?? 0, parts[1] ?? 1, parts[2] ?? 1]
}

/**
 * The Monday (YYYY-MM-DD) for a given week offset relative to the week
 * containing `now`. offset 0 = this week's Monday, +1 = next Monday, -1 =
 * previous Monday, etc. `now` defaults to the current time so callers usually
 * pass only the offset.
 */
export function weekStartForOffset(
  offset: number,
  now: Date = new Date(),
): string {
  // Parse the YYYY-MM-DD Monday back to a UTC date, shift by offset weeks.
  const [y, m, day] = ymd(mondayOf(now))
  const date = new Date(Date.UTC(y, m - 1, day))
  date.setUTCDate(date.getUTCDate() + offset * 7)
  return date.toISOString().slice(0, 10)
}

/**
 * The integer week offset of `weekStart` (a Monday YYYY-MM-DD) relative to the
 * week containing `now`. Inverse of `weekStartForOffset`: round-trips so a
 * deep-link by date can map back to "this week / next week / +N".
 */
export function offsetForWeekStart(
  weekStart: string,
  now: Date = new Date(),
): number {
  const [y, m, d] = ymd(weekStart)
  const target = Date.UTC(y, m - 1, d)
  const [by, bm, bd] = ymd(mondayOf(now))
  const base = Date.UTC(by, bm - 1, bd)
  return Math.round((target - base) / (7 * 24 * 60 * 60 * 1000))
}

/** A human label for a week offset: "This week" / "Next week" / "Last week" / dated. */
export function weekLabel(offset: number, now: Date = new Date()): string {
  if (offset === 0) return 'This week'
  if (offset === 1) return 'Next week'
  if (offset === -1) return 'Last week'
  const [y, m, d] = ymd(weekStartForOffset(offset, now))
  const date = new Date(Date.UTC(y, m - 1, d))
  const label = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  return `Week of ${label}`
}
