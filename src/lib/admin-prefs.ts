/**
 * Pure helpers for per-admin waitlist-notification preferences, with NO env / DB
 * imports so they unit-test cleanly. Default-on: an admin with no stored row
 * receives waitlist-signup emails; a row only records a deviation.
 */

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

/** A stored preference row (only the fields the rules need). */
export interface NotifyPref {
  email: string
  waitlistNotify: boolean
}

/**
 * Whether one admin should be notified, given their stored row (or none).
 * Absent row => enabled (default-on).
 */
export function notifyEnabled(
  row: { waitlistNotify: boolean } | undefined,
): boolean {
  return row ? row.waitlistNotify : true
}

/**
 * Given the resolved admin list and the stored preference rows, return the
 * emails to notify of a new waitlist signup. Admins without a row default to
 * enabled; an explicit `waitlistNotify: false` opts them out. Matching is
 * normalised so env casing/whitespace never causes a mismatch.
 */
export function recipientsForWaitlist(
  admins: Array<string>,
  prefs: Array<NotifyPref>,
): Array<string> {
  const byEmail = new Map(
    prefs.map((p) => [normalize(p.email), p.waitlistNotify]),
  )
  return admins.filter((email) => {
    const v = byEmail.get(normalize(email))
    return v === undefined ? true : v
  })
}
