/**
 * Pure helpers for signup attribution ("How did you find us?"): the source
 * bucket -> display-label map shared by the onboarding step and the admin email,
 * and the body lines that surface source + referrer in the new-user notice.
 *
 * Kept pure + exported so the email body is locked by unit tests (the
 * feedback-email pattern), and so the source vocabulary lives in one place.
 *
 * ABSENCE = UNKNOWN: a null attribution (a user who onboarded before we asked,
 * or who skipped the step) reads as "Source: not provided". Nothing here
 * backfills or assumes a value.
 */

/** Display labels for each stored source bucket. */
const SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  word_of_mouth: 'Word of mouth',
  other: 'Other',
}

/** A persisted/threaded attribution. All fields optional — the step is skippable. */
export interface AttributionInput {
  source?: string | null
  sourceOther?: string | null
  referrer?: string | null
}

/** The onboarding-draft slice this reads (a structural subset of OnboardingDraft). */
export interface AttributionDraftSlice {
  source?: string | null
  sourceOther?: string | null
  referrer?: string | null
}

/**
 * Normalise the draft's attribution fields into the row we store /  thread:
 * empty strings and whitespace-only free text collapse to null, so an unanswered
 * field reads as null (not ''). A user who picked nothing stores all-null, which
 * is still a ROW (distinct from a pre-feature user, who has NO row at all).
 */
export function attributionRowFromDraft(draft: AttributionDraftSlice): {
  source: string | null
  sourceOther: string | null
  referrer: string | null
} {
  const source = draft.source ? draft.source : null
  const sourceOther = (draft.sourceOther ?? '').trim() || null
  const referrer = (draft.referrer ?? '').trim() || null
  return { source, sourceOther, referrer }
}

/**
 * Map a stored source bucket to its human label, or 'not provided' for an
 * empty / unknown / absent bucket (the user skipped, or joined before we asked).
 */
export function sourceLabel(source: string | null | undefined): string {
  if (!source) return 'not provided'
  return SOURCE_LABELS[source] ?? 'not provided'
}

/**
 * The attribution lines for the admin email body: always a "Source:" line, plus
 * a "Referred by:" line only when a referrer was actually given. A null/absent
 * attribution degrades to "Source: not provided".
 */
export function attributionNoticeLines(
  attribution: AttributionInput | null | undefined,
): string {
  const source = attribution?.source ?? ''
  const sourceOther = (attribution?.sourceOther ?? '').trim()
  const referrer = (attribution?.referrer ?? '').trim()

  const label = sourceLabel(source)
  // For 'other' with free text, surface what they typed alongside the bucket.
  const sourceLine =
    source === 'other' && sourceOther
      ? `Source: Other (${sourceOther})`
      : `Source: ${label}`

  const lines = [sourceLine]
  if (referrer) lines.push(`Referred by: ${referrer}`)
  return lines.join('\n')
}

/**
 * The full plain-text body for the admin "new signup" email, including the
 * attribution. Pure so it is unit-tested; `sendNewUserNotice` just wraps it in
 * a Resend send.
 */
export function newUserNoticeText(
  newEmail: string,
  totalUsers: number,
  attribution: AttributionInput | null | undefined,
): string {
  return [
    `${newEmail} just created a Souso account. Total accounts: ${totalUsers}.`,
    '',
    attributionNoticeLines(attribution),
  ].join('\n')
}
