/**
 * Pure view-logic for the admin Users page: totals, signups-over-time buckets,
 * filtering and sorting. NO db / server imports (it only imports the AdminUserRow
 * TYPE, erased at build), so the client component can import it directly without
 * dragging `cloudflare:workers` into the browser bundle. `now` is always passed
 * in (never Date.now()) so the time-based helpers are deterministic under test.
 */
import type { AdminUserRow } from '#/lib/admin-server'

const DAY_MS = 24 * 60 * 60 * 1000

/** Aggregate counts shown in the stat cards above the user list. */
export interface UsersSummary {
  /** Every person the merge surfaced (signed-in + env/grant-only). */
  total: number
  /** People who finished onboarding (have a household). */
  onboarded: number
  /** People with admin access. */
  admins: number
  /** Total swipes across all households. */
  swipes: number
  /** Accounts created in the last 7 days (strict: > now - 7d). */
  newThisWeek: number
}

/**
 * Derive the headline totals from the rows. `now` (epoch ms) anchors the
 * "new this week" window; a null createdAt never counts as new.
 */
export function summarizeUsers(
  rows: ReadonlyArray<AdminUserRow>,
  now: number,
): UsersSummary {
  const weekAgo = now - 7 * DAY_MS
  let onboarded = 0
  let admins = 0
  let swipes = 0
  let newThisWeek = 0
  for (const r of rows) {
    if (r.onboarded) onboarded++
    if (r.isAdmin) admins++
    swipes += r.swipes
    if (r.createdAt != null && r.createdAt > weekAgo) newThisWeek++
  }
  return { total: rows.length, onboarded, admins, swipes, newThisWeek }
}

/** One day's signup count, keyed by its UTC calendar date (yyyy-mm-dd). */
export interface DayBucket {
  /** UTC calendar date, yyyy-mm-dd. */
  date: string
  count: number
}

/** UTC yyyy-mm-dd for an epoch-ms instant. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Bucket signups per UTC day over the last `days` days, oldest first, zero-
 * filled so the chart has a bar for every day even with no signups. The last
 * bucket is "today" (the UTC day containing `now`). Rows with a null createdAt,
 * or one outside the window, are ignored.
 */
export function signupsByDay(
  rows: ReadonlyArray<AdminUserRow>,
  now: number,
  days: number,
): Array<DayBucket> {
  const todayStart = Date.parse(`${isoDay(now)}T00:00:00.000Z`)
  // Build the zero-filled buckets, oldest first.
  const buckets: Array<DayBucket> = []
  const indexByDate = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) {
    const date = isoDay(todayStart - i * DAY_MS)
    indexByDate.set(date, buckets.length)
    buckets.push({ date, count: 0 })
  }
  for (const r of rows) {
    if (r.createdAt == null) continue
    const idx = indexByDate.get(isoDay(r.createdAt))
    if (idx !== undefined) {
      const bucket = buckets[idx]
      if (bucket) bucket.count++
    }
  }
  return buckets
}

/** Which access bucket a list filter narrows to. */
export type AccessFilter = 'all' | 'onboarded' | 'not-onboarded' | 'admins'

export interface FilterArgs {
  /** Case-insensitive email substring. Empty / whitespace matches everything. */
  query?: string
  /** Access bucket. Defaults to 'all'. */
  access?: AccessFilter
}

/**
 * Filter the rows by email substring (case-insensitive) and access bucket.
 * Returns a NEW array (never mutates the input).
 */
export function filterUsers(
  rows: ReadonlyArray<AdminUserRow>,
  args: FilterArgs,
): Array<AdminUserRow> {
  const q = (args.query ?? '').trim().toLowerCase()
  const access = args.access ?? 'all'
  return rows.filter((r) => {
    if (q && !r.email.toLowerCase().includes(q)) return false
    switch (access) {
      case 'onboarded':
        return r.onboarded
      case 'not-onboarded':
        return !r.onboarded
      case 'admins':
        return r.isAdmin
      default:
        return true
    }
  })
}

/** Sort keys the admin can pick. */
export type SortKey = 'newest' | 'email' | 'swipes'

/**
 * Sort the rows by the chosen key. Returns a NEW array (never mutates the
 * input). 'newest' puts the most-recent signup first and pushes null-createdAt
 * rows to the end (keeping their incoming relative order, so the merge's default
 * ordering still shows through for never-signed-in people).
 */
export function sortUsers(
  rows: ReadonlyArray<AdminUserRow>,
  key: SortKey,
): Array<AdminUserRow> {
  const out = [...rows]
  switch (key) {
    case 'email':
      out.sort((a, b) => a.email.localeCompare(b.email))
      break
    case 'swipes':
      out.sort((a, b) => b.swipes - a.swipes)
      break
    case 'newest':
      out.sort((a, b) => {
        // Nulls last; equal/both-null keep incoming order (Array.sort is stable).
        if (a.createdAt == null && b.createdAt == null) return 0
        if (a.createdAt == null) return 1
        if (b.createdAt == null) return -1
        return b.createdAt - a.createdAt
      })
      break
  }
  return out
}
