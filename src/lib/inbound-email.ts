/**
 * Pure shaping for the admin "Inbound emails" panel (#459) — the emails received
 * at hello@souso.app. Kept free of any server-only import (no network) so it's
 * unit-testable; the server fn in `inbound-email-server.ts` does the fetch + env
 * read and hands the raw Resend JSON here.
 *
 * Resend exposes a List Received Emails endpoint (GET /emails/receiving) wrapping
 * items in `{ object, has_more, data: [...] }`, each item shaped like
 * `{ id, from, to, subject, created_at, ... }`. We prefer this Resend-direct read
 * over a bespoke DB table (the issue's explicit steer). We tolerate a missing /
 * mistyped payload so a shape change can't crash the panel.
 */

/** One received email as the admin panel renders it. */
export interface InboundEmailItem {
  id: string
  from: string | null
  to: Array<string>
  subject: string | null
  /** epoch ms, or null when Resend sent no/invalid date. Drives sort + display. */
  createdAtMs: number | null
}

/** The full result the server fn returns: items + an optional human note. */
export interface InboundEmailResult {
  items: Array<InboundEmailItem>
  /** A short note for the admin when the panel can't show live data. null when fine. */
  note: string | null
}

export const RESEND_KEY_MISSING_NOTE =
  'Set the RESEND_API_KEY secret to list emails received at hello@souso.app here.'

export const RESEND_FETCH_FAILED_NOTE =
  'Could not reach Resend just now. Inbound emails will appear here once the API is reachable.'

/**
 * Note shown when Resend returns a 404 / "not enabled" for the receiving
 * endpoint — inbound receiving is a Resend feature that must be turned on for the
 * domain. We surface that inbound mail is also forwarded to admins (#457) so the
 * panel is honest about where the mail actually lands.
 */
export const RESEND_INBOUND_UNAVAILABLE_NOTE =
  'Resend inbound listing is not available for this domain yet. Emails to hello@souso.app are forwarded to the admin inbox (see #457).'

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null
}

function asStringArray(v: unknown): Array<string> {
  if (Array.isArray(v))
    return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string' && v.trim().length > 0) return [v]
  return []
}

function toMs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Shape the raw Resend received-emails JSON into the panel's item list, newest
 * first. Accepts either the `{ data: [...] }` envelope or a bare array, tolerates
 * junk, and coerces every field defensively so a Resend shape change degrades to
 * fewer fields rather than a thrown error.
 */
export function shapeInboundEmails(payload: unknown): Array<InboundEmailItem> {
  const rows = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as Record<string, unknown>).data)
      ? ((payload as Record<string, unknown>).data as Array<unknown>)
      : []

  const items: Array<InboundEmailItem> = []
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    items.push({
      id: asString(r.id) ?? crypto.randomUUID(),
      from: asString(r.from),
      to: asStringArray(r.to),
      subject: asString(r.subject),
      createdAtMs: toMs(r.created_at),
    })
  }
  items.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
  return items
}
