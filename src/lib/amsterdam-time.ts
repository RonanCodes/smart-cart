/**
 * Pure Europe/Amsterdam wall-clock helpers for the scheduled nudges (Part C).
 *
 * The Worker cron fires every 15 minutes with a UTC instant. Both pushes are
 * scheduled in LOCAL Amsterdam time (which shifts with CET/CEST), so we project
 * the instant into Amsterdam wall-clock parts via `Intl.DateTimeFormat` (Workers
 * support the IANA tz database) and reason about those parts. No DB, no Worker
 * env — so this is unit-testable by passing any `Date`.
 *
 * The 15-minute cron means each scheduled time falls into exactly one tick. We
 * "bucket" a time by flooring its minute to the 15-min grid, so "is it 20:00?"
 * means "is the current tick the one covering 20:00..20:14?". Dedupe (a sent
 * marker per household+date/week) stops a same-bucket re-fire.
 */

export const AMSTERDAM_TZ = 'Europe/Amsterdam'

/** Amsterdam wall-clock parts for a UTC instant. */
export interface AmsterdamParts {
  /** Calendar date in Amsterdam, YYYY-MM-DD. */
  date: string
  /** Hour 0..23 (Amsterdam local). */
  hour: number
  /** Minute 0..59 (Amsterdam local). */
  minute: number
  /** Day of week, 0 = Sunday .. 6 = Saturday (Amsterdam local). */
  dow: number
}

const WEEKDAY_TO_DOW: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
}

/** Project a UTC instant to its Europe/Amsterdam wall-clock parts. */
export function amsterdamParts(now: Date): AmsterdamParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: AMSTERDAM_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  })
  const parts = fmt.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const year = get('year')
  const month = get('month')
  const day = get('day')
  // hour12:false can emit '24' at midnight in some engines; normalise to 0.
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const minute = Number(get('minute'))
  const dow = WEEKDAY_TO_DOW[get('weekday')] ?? 0
  return { date: `${year}-${month}-${day}`, hour, minute, dow }
}

/** Floor a minute to the 15-minute grid (0,15,30,45). */
export function floorTo15(minute: number): number {
  return Math.floor(minute / 15) * 15
}

/**
 * True when `now` (UTC) falls in the same 15-minute bucket as Amsterdam-local
 * `hh:mm`. e.g. target 20:00 matches a tick at any Amsterdam 20:00..20:14.
 */
export function isInBucket(now: Date, hour: number, minute: number): boolean {
  const p = amsterdamParts(now)
  return p.hour === hour && floorTo15(p.minute) === floorTo15(minute)
}

/** True when the current Amsterdam tick covers the daily 20:00 rate-meal slot. */
export function isRateMealBucket(now: Date): boolean {
  return isInBucket(now, 20, 0)
}

/**
 * True when `now` matches a household's weekly-plan reminder: the Amsterdam
 * day-of-week equals `dow` AND the current tick covers the 'HH:MM' time.
 */
export function isPlanReminderBucket(
  now: Date,
  dow: number,
  time: string,
): boolean {
  const m = /^([0-9]{2}):([0-9]{2})$/.exec(time)
  if (!m) return false
  const p = amsterdamParts(now)
  if (p.dow !== dow) return false
  return (
    p.hour === Number(m[1]) && floorTo15(p.minute) === floorTo15(Number(m[2]))
  )
}
