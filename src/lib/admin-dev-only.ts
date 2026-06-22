/**
 * Pure decision helpers for dev-only admin surfaces (#460). Kept free of any
 * `import.meta.env` reference so they're trivially unit-testable; the route +
 * nav pass `import.meta.env.DEV` in as the argument.
 *
 * The benchmark / algorithm-testing page no longer makes sense after the
 * matching rework AND only runs on localhost, so it must be hidden on the
 * deployed build: the route redirects away and the nav link is not rendered
 * unless we're in dev.
 */

/**
 * Should the dev-only benchmark route render, given whether we're in a dev
 * build? Exactly `isDev` — extracted as a named helper so the route's
 * beforeLoad reads as intent ("show benchmark only in dev") and is locked by a
 * unit test rather than an inline boolean.
 */
export function showBenchmark(isDev: boolean): boolean {
  return isDev
}
