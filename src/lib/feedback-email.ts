/**
 * Pure builders for the admin feedback-notice email (#feedback-and-videos), kept
 * free of any server-only import (no Resend, no network) so the body + the Sentry
 * deep-link are unit-testable in isolation. `email.ts`'s `sendFeedbackNotice`
 * calls these to assemble the text + html it hands Resend.
 *
 * Everything degrades gracefully: no Sentry event id => no Sentry line, no
 * contact => "no contact left", and the timestamp always renders (defaulting to
 * now when the caller passes nothing). A missing piece never throws.
 */

/** Our personal Sentry, EU region. Org `ronan-connolly`, project `souso`. */
const SENTRY_HOST = 'de.sentry.io'
const SENTRY_ORG = 'ronan-connolly'
const SENTRY_PROJECT = 'souso'

/**
 * Deep-link to the Sentry issue/event for a feedback submission, or null when no
 * event id was captured (Sentry skipped in dev, or the capture failed). The
 * org-scoped UI lives at `{org}.{host}`; searching the event id lands the admin
 * on the right issue. Mirrors `sentryEventUrl` in sentry-admin.ts so the link
 * shape stays identical across the admin panel and the email.
 */
export function feedbackSentryUrl(
  eventId: string | null | undefined,
): string | null {
  const id = (eventId ?? '').trim()
  if (!id) return null
  return `https://${SENTRY_ORG}.${SENTRY_HOST}/${SENTRY_PROJECT}/?query=${encodeURIComponent(id)}`
}

export interface FeedbackNoticeInput {
  message: string
  email?: string | null
  phone?: string | null
  source?: string | null
  /** The Sentry event id from captureSentryFeedback, when one was captured. */
  sentryEventId?: string | null
  /** When the feedback was submitted; defaults to now. */
  submittedAt?: Date | null
}

/** The contact line: email · phone, or a clear "none" when the sender left none. */
export function feedbackContactLine(input: {
  email?: string | null
  phone?: string | null
}): string {
  return (
    [input.email, input.phone].filter(Boolean).join(' · ') || 'no contact left'
  )
}

/** A stable, human-readable timestamp for the email body (UTC, ISO-like). */
function formatSubmittedAt(at: Date): string {
  // Guard a junk Date (NaN) so a bad input never throws or renders "Invalid Date".
  const safe = Number.isFinite(at.getTime()) ? at : new Date()
  return safe
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC')
}

/**
 * The plain-text body of the admin feedback notice. Always carries the message,
 * the contact line, a submitted-at timestamp, and, when a Sentry event id is
 * present, a link to the Sentry issue. Pure + exported so the body is locked by
 * a test without sending a real email.
 */
export function feedbackNoticeText(input: FeedbackNoticeInput): string {
  const contact = feedbackContactLine(input)
  const at = formatSubmittedAt(input.submittedAt ?? new Date())
  const sentryUrl = feedbackSentryUrl(input.sentryEventId)
  const lines = [input.message, '', `Contact: ${contact}`, `Submitted: ${at}`]
  if (sentryUrl) lines.push(`Sentry: ${sentryUrl}`)
  return lines.join('\n')
}

/**
 * The HTML body of the admin feedback notice. Same content as the text body,
 * lightly styled. The Sentry line is a real link when present; otherwise omitted.
 * No external assets, so it renders the same in any mail client.
 */
export function feedbackNoticeHtml(input: FeedbackNoticeInput): string {
  const contact = feedbackContactLine(input)
  const at = formatSubmittedAt(input.submittedAt ?? new Date())
  const sentryUrl = feedbackSentryUrl(input.sentryEventId)
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const sentryBlock = sentryUrl
    ? `<p style="margin:0 0 4px;color:#5b6b5b;font-size:13px;">Sentry: <a href="${sentryUrl}" style="color:#43A047;">view in Sentry</a></p>`
    : ''
  return `
    <p style="margin:0 0 16px;color:#1f2a1f;font-size:15px;line-height:1.5;white-space:pre-wrap;">${esc(input.message)}</p>
    <p style="margin:0 0 4px;color:#5b6b5b;font-size:13px;">Contact: ${esc(contact)}</p>
    <p style="margin:0 0 4px;color:#5b6b5b;font-size:13px;">Submitted: ${esc(at)}</p>
    ${sentryBlock}`
}
