/**
 * Pure feedback-submission logic, kept free of any server-only import so it can
 * be unit-tested in isolation (the meal-feedback / meal-feedback-server split
 * pattern). The server fn in `app-feedback-server.ts` calls `normaliseFeedback`
 * at the request boundary and only writes when it returns an `ok` row.
 */

/** The contact-email fallback shown in the form. A real inbox the team reads. */
export const FEEDBACK_CONTACT_EMAIL = 'hello@souso.app'

/** Where a submission came from, for admin triage. `tab-bar` is the bottom
 * tab-bar FAB (the always-on trigger), `settings` is the Settings entry,
 * `sign-in` is the trigger on the sign-in page for users blocked at login, and
 * `error-boundary` is the "something is not right" path on the crash screen
 * (a user who hit the global error boundary and chose to tell us about it). */
export type FeedbackSource =
  | 'tab-bar'
  | 'settings'
  | 'sign-in'
  | 'error-boundary'

/** The valid sources, so a stray string at the boundary falls back to the
 * default rather than being stored verbatim. */
const FEEDBACK_SOURCES: ReadonlyArray<FeedbackSource> = [
  'tab-bar',
  'settings',
  'sign-in',
  'error-boundary',
]

/** The raw form input as it arrives from the client. */
export interface FeedbackInput {
  message: string
  /** An optional contact email the sender typed (guests, or to be reachable). */
  email?: string | null
  /** An optional phone / WhatsApp number so the team can reach out for a chat. */
  phone?: string | null
  source?: FeedbackSource
  path?: string | null
  /** The Sentry event id returned by captureSentryFeedback, so the admin email
   * can deep-link to the Sentry issue. Optional: absent in dev / on capture
   * failure, and the email degrades to no Sentry line. */
  sentryEventId?: string | null
  /** An optional attached screenshot, base64-encoded (no `data:` prefix) so it
   * crosses the server-fn boundary as JSON, then rides the admin email as a
   * Resend attachment. */
  screenshot?: {
    filename: string
    base64: string
  } | null
}

/** The cleaned, ready-to-insert row (no id / userId / createdAt — the server
 * adds those). */
export interface NormalisedFeedback {
  message: string
  email: string | null
  phone: string | null
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
 * Normalise an optional phone / WhatsApp number for feedback. Trims, keeps a
 * plausible number (at least 6 digits among the usual +, spaces, -, () chars),
 * and returns null for empty / too-short input so a stray keypress is not stored
 * as a "number". Pure + lenient on purpose (international formats vary). Mirrors
 * the onboarding `normalisePhone`; kept local so app-feedback has no onboarding
 * import.
 */
export function normaliseFeedbackPhone(
  raw: string | null | undefined,
): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 6) return null
  return trimmed
}

/** The email field's resolved state for the form (pure, so it is unit-testable
 * without rendering). When a signed-in session email exists we prefill it and
 * lock the field read-only ("sending as <email>"); signed out, the field is
 * editable and optional. */
export interface FeedbackEmailState {
  value: string
  readOnly: boolean
}

export function feedbackEmailState(
  sessionEmail: string | null | undefined,
): FeedbackEmailState {
  const email = (sessionEmail ?? '').trim()
  return email.length > 0
    ? { value: email, readOnly: true }
    : { value: '', readOnly: false }
}

/**
 * Validate + clean a feedback submission. Trims the message and rejects an empty
 * (or whitespace-only) one, trims the optional email and rejects a clearly
 * malformed one (a blank email is allowed — it is optional), normalises the
 * optional phone (a too-short one is dropped, never rejected), clamps an overly
 * long message, and defaults the source to 'tab-bar'. Returns a discriminated
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
      phone: normaliseFeedbackPhone(input.phone),
      source:
        input.source && FEEDBACK_SOURCES.includes(input.source)
          ? input.source
          : 'tab-bar',
      path: input.path?.trim() ? input.path.trim() : null,
    },
  }
}
