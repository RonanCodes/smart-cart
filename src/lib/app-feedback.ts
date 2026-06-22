/**
 * Pure feedback-submission logic, kept free of any server-only import so it can
 * be unit-tested in isolation (the meal-feedback / meal-feedback-server split
 * pattern). The server fn in `app-feedback-server.ts` calls `normaliseFeedback`
 * at the request boundary and only writes when it returns an `ok` row.
 */

/** The contact-email fallback shown in the form. A real inbox the team reads. */
export const FEEDBACK_CONTACT_EMAIL = 'hello@souso.app'

/** Where a submission came from, for admin triage. */
export type FeedbackSource = 'bubble' | 'settings'

/** The raw form input as it arrives from the client. */
export interface FeedbackInput {
  message: string
  /** An optional contact email the sender typed (guests, or to be reachable). */
  email?: string | null
  source?: FeedbackSource
  path?: string | null
}

/** The cleaned, ready-to-insert row (no id / userId / createdAt — the server
 * adds those). */
export interface NormalisedFeedback {
  message: string
  email: string | null
  source: FeedbackSource
  path: string | null
}

export type NormaliseResult =
  | { ok: true; value: NormalisedFeedback }
  | { ok: false; error: string }

/** A message must have real content; this is the hard floor. */
export const MIN_FEEDBACK_LENGTH = 2
/** Cap the stored message so one paste can't write an unbounded row. */
export const MAX_FEEDBACK_LENGTH = 4000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validate + clean a feedback submission. Trims the message and rejects an empty
 * (or whitespace-only) one, trims the optional email and rejects a clearly
 * malformed one (a blank email is allowed — it is optional), clamps an overly
 * long message, and defaults the source to 'bubble'. Returns a discriminated
 * result so the caller writes only on `ok`.
 */
export function normaliseFeedback(input: FeedbackInput): NormaliseResult {
  const message = input.message.trim()
  if (message.length < MIN_FEEDBACK_LENGTH) {
    return { ok: false, error: 'Please write a little more.' }
  }

  const rawEmail = (input.email ?? '').trim()
  if (rawEmail.length > 0 && !EMAIL_RE.test(rawEmail)) {
    return { ok: false, error: 'That email does not look right.' }
  }

  return {
    ok: true,
    value: {
      message: message.slice(0, MAX_FEEDBACK_LENGTH),
      email: rawEmail.length > 0 ? rawEmail : null,
      source: input.source === 'settings' ? 'settings' : 'bubble',
      path: input.path?.trim() ? input.path.trim() : null,
    },
  }
}
