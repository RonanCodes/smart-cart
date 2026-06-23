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

/**
 * What the /week COMPONENT should render for a given loader payload: the
 * component-level read guard (#400/#380 extended: the loader already coerces a
 * transient 500 to `{ kind: 'empty' }`, but the COMPONENT still read
 * `loaderData.kind` / `loaderData.week` and could throw if the payload was
 * `undefined`/`null`/partial/errored).
 *
 * After "Build my week" the freshly-created plan/household can race the read, so
 * the planner/week server fns transiently 500. Rather than crash into the global
 * error boundary ("something went wrong") and recover on a refetch, we classify
 * the payload here and let the component render a calm "setting up your week"
 * state instead:
 *  - `'empty'`: a genuine empty week (a past week never planned, or a future week
 *    not yet generated), OR a degraded/partial/undefined payload we can't render
 *    as a week, both land on the empty/loading shell with a real `offset`;
 *  - `'week'`: a usable WeekView we can render in full.
 *
 * Pure + client-safe (no server import) so it's unit-testable and shared by the
 * loader + the component without re-deriving the branch logic.
 */
export type WeekRenderState =
  | { kind: 'empty'; offset: number }
  | { kind: 'week'; offset: number }

export function resolveWeekRender(loaderData: unknown): WeekRenderState {
  // A missing / non-object payload (a transient 500 that slipped past the loader
  // guards, an aborted fetch): render the empty shell for this week, never throw
  // on `loaderData.kind`.
  if (typeof loaderData !== 'object' || loaderData === null) {
    return { kind: 'empty', offset: 0 }
  }
  const data = loaderData as Record<string, unknown>
  const offset = typeof data.offset === 'number' ? data.offset : 0
  // A `kind: 'week'` payload is only renderable as a week if its `week` is a
  // usable WeekView; a partial/errored week falls back to the empty shell.
  if (data.kind === 'week' && isWeekView(data.week)) {
    return { kind: 'week', offset }
  }
  // Everything else (an explicit empty, a partial week, an unknown kind) renders
  // the empty shell.
  return { kind: 'empty', offset }
}
