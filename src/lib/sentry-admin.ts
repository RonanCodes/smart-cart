/**
 * Pure shaping logic for the admin "Sentry feedback" panel (#458), kept free of
 * any server-only import (no cloudflare:workers, no network) so it can be unit
 * tested in isolation. The server fn in `sentry-admin-server.ts` does the fetch
 * + the env read, then hands the raw JSON to `shapeSentryFeedback` here.
 *
 * Sentry's user-feedback endpoint
 * (GET /api/0/projects/{org}/{project}/user-feedback/) returns items shaped like
 * `{ id, name, email, comments, dateCreated, eventID }`. We tolerate missing /
 * mistyped fields and a non-array payload, so a Sentry API change can never crash
 * the panel.
 */

/** One feedback entry as the admin panel renders it. */
export interface SentryFeedbackItem {
  id: string
  name: string | null
  email: string | null
  comments: string
  /** epoch ms, or null when Sentry sent no/invalid date. Drives sort + display. */
  createdAtMs: number | null
  /** Deep-link target on de.sentry.io, null when there is no associated event. */
  eventID: string | null
}

/** The full result the server fn returns: items + an optional human note. */
export interface SentryFeedbackResult {
  items: Array<SentryFeedbackItem>
  /**
   * A short note for the admin when the panel can't show live data — e.g. the
   * token is unset, or the Sentry call failed. null when everything is fine.
   */
  note: string | null
}

/** The note shown when SENTRY_AUTH_TOKEN is not configured. */
export const SENTRY_TOKEN_MISSING_NOTE =
  'Set the SENTRY_AUTH_TOKEN secret to show live Sentry user feedback here.'

/** The note shown when the Sentry API call failed (network / non-200 / parse). */
export const SENTRY_FETCH_FAILED_NOTE =
  'Could not reach Sentry just now. Feedback will appear here once the API is reachable.'

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null
}

/** Parse Sentry's ISO `dateCreated` to epoch ms, tolerating junk. */
function toMs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Shape the raw Sentry user-feedback JSON into the panel's item list, newest
 * first. Tolerates a non-array payload (returns []), drops entries with no
 * comment text (a feedback entry with nothing to read is noise), and coerces
 * every field defensively so a shape change in the Sentry API degrades to fewer
 * fields rather than a thrown error.
 */
export function shapeSentryFeedback(
  payload: unknown,
): Array<SentryFeedbackItem> {
  if (!Array.isArray(payload)) return []
  const items: Array<SentryFeedbackItem> = []
  for (const raw of payload) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const comments = asString(r.comments)
    if (!comments) continue
    items.push({
      id: asString(r.id) ?? crypto.randomUUID(),
      name: asString(r.name),
      email: asString(r.email),
      comments,
      createdAtMs: toMs(r.dateCreated),
      eventID: asString(r.eventID),
    })
  }
  // Newest first; entries with no date sort last (treated as oldest).
  items.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
  return items
}

/**
 * Build the Sentry user-feedback API URL for a project. Centralised so the host
 * + path shape is unit-testable and identical to what the server fn calls.
 */
export function sentryFeedbackUrl(opts: {
  host: string
  org: string
  project: string
}): string {
  const { host, org, project } = opts
  return `https://${host}/api/0/projects/${org}/${project}/user-feedback/`
}

/**
 * Deep-link to one feedback's event in the Sentry UI, or null when no event.
 * The org-scoped UI lives at `https://{org}.{host}` (e.g.
 * ronan-connolly.de.sentry.io); the event search lands the admin on the right
 * issue without needing to know its internal id.
 */
export function sentryEventUrl(opts: {
  host: string
  org: string
  project: string
  eventID: string | null
}): string | null {
  const { host, org, project, eventID } = opts
  if (!eventID) return null
  return `https://${org}.${host}/${project}/?query=${encodeURIComponent(eventID)}`
}
