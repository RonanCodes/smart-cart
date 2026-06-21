/**
 * Pure helpers + validation for the weekly-plan reminder preference (Part B).
 * No DB, no Worker — so they run identically in unit tests, the client (to guard
 * the form before a round-trip), and the server fn.
 */

/** The household's weekly-plan reminder preference, as the UI + server share it. */
export interface NotifyPrefs {
  enabled: boolean
  /** Day of week: 0 = Sunday .. 6 = Saturday. */
  dow: number
  /** Local (Europe/Amsterdam) time, 'HH:MM' 24h. */
  time: string
}

/** The default a household with no stored row is treated as (opt-in, off). */
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  enabled: false,
  dow: 0,
  time: '17:00',
}

/** Day labels for the picker, indexed 0=Sunday..6=Saturday. */
export const DOW_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

/** True when `dow` is an integer in 0..6. */
export function isValidDow(dow: unknown): dow is number {
  return (
    typeof dow === 'number' && Number.isInteger(dow) && dow >= 0 && dow <= 6
  )
}

/** True when `time` is a 'HH:MM' 24h string (00:00..23:59). */
export function isValidTime(time: unknown): time is string {
  if (typeof time !== 'string') return false
  const m = /^([0-9]{2}):([0-9]{2})$/.exec(time)
  if (!m) return false
  const h = Number(m[1])
  const min = Number(m[2])
  return h >= 0 && h <= 23 && min >= 0 && min <= 59
}

/**
 * Validate + normalise raw input into a NotifyPrefs, or throw a clear error. Used
 * by the server fn so a malformed dow/time is rejected before any write.
 */
export function validateNotifyPrefs(input: {
  enabled: unknown
  dow: unknown
  time: unknown
}): NotifyPrefs {
  if (typeof input.enabled !== 'boolean') {
    throw new Error('enabled must be a boolean')
  }
  if (!isValidDow(input.dow)) {
    throw new Error('dow must be an integer 0-6 (0 = Sunday)')
  }
  if (!isValidTime(input.time)) {
    throw new Error("time must be 'HH:MM' 24h")
  }
  return { enabled: input.enabled, dow: input.dow, time: input.time }
}
