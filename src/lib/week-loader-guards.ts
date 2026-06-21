import type { WeekView } from './week-server'

/**
 * Runtime guards for the /week loader + render path (#380, #384).
 *
 * The week route reads deeply into server-fn results (`res.week.planId`,
 * `bootstrap.week.weekStart`, `missing.missing`) on the happy path. A prod 500
 * makes a server fn resolve to `undefined` instead of its declared type, and the
 * declared types can't see that — so a single bad fan-out crashed the route on
 * `t.week` / `t.days` / `.missing` (the three Sentry groups). These pure helpers
 * coerce a malformed result into a safe shape so the route renders an empty
 * state (or a recoverable count) instead of throwing into the error boundary.
 *
 * Client-safe: no `cloudflare:workers` import, so it can be imported by the
 * route's loader AND its render path.
 */

/**
 * Whether a value is a usable WeekView: an object with a `planId` string and a
 * `days` array. Anything else (undefined, a 500 envelope, a partial week with no
 * `days`) is rejected so callers fall back to the empty state instead of reading
 * `.days` off undefined (#380).
 */
export function isWeekView(value: unknown): value is WeekView {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.planId === 'string' && Array.isArray(v.days)
}

/**
 * Coerce a `countMissingFromWeek`-shaped result into a non-negative integer
 * (#384). The loader reads `.missing` off the result; a prod 500 resolved the
 * fn to `undefined`, so `undefined.missing` threw in the loader. Treat anything
 * that isn't a finite count as 0 (nothing known to be missing).
 */
export function missingCount(result: unknown): number {
  if (typeof result !== 'object' || result === null) return 0
  const m = (result as Record<string, unknown>).missing
  if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) return 0
  return Math.trunc(m)
}

/**
 * Guard a week's `days` for the render path (#380). A week that survived
 * `isWeekView` always has an array `days`, but this keeps the render-side read
 * total even if a future code path hands a half-built week to the component:
 * returns an empty list rather than letting `.map`/`.find` throw.
 */
export function weekDays(week: WeekView | null | undefined): WeekView['days'] {
  if (!week || !Array.isArray(week.days)) return []
  return week.days
}
