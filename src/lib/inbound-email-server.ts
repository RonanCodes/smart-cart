import { createServerFn } from '@tanstack/react-start'
import {
  shapeInboundEmails,
  RESEND_KEY_MISSING_NOTE,
  RESEND_FETCH_FAILED_NOTE,
  RESEND_INBOUND_UNAVAILABLE_NOTE,
} from './inbound-email'
import type { InboundEmailResult } from './inbound-email'

/**
 * List inbound emails received at hello@souso.app for the admin portal (#459).
 *
 * INVESTIGATION (documented in the PR): Resend DOES expose a received-emails list
 * endpoint — GET https://api.resend.com/emails/receiving (Bearer RESEND_API_KEY),
 * returning `{ object, has_more, data: [...] }`. We query it directly rather than
 * building a bespoke DB table, per the issue's "prefer Resend-direct over our own
 * DB" steer. Note that inbound receiving is a per-domain Resend feature: if it's
 * not enabled for souso.app the endpoint 404s, so we degrade to a note that
 * inbound mail is forwarded to admins (see #457) instead.
 *
 * NEVER throws (observability/network must not crash a request): unset key →
 * empty list + "set RESEND_API_KEY" note; 404 → empty list + "inbound not
 * available, forwarded to admins" note; any other failure → empty list +
 * "couldn't reach Resend" note. The pure shaping lives in inbound-email.ts and is
 * unit tested. Server-only: handler body stripped from the client bundle, readEnv
 * dynamic-imports `cloudflare:workers`. Admin-gated by the /admin beforeLoad.
 */

const RESEND_RECEIVING_URL = 'https://api.resend.com/emails/receiving'

export const listInboundEmails = createServerFn({ method: 'GET' }).handler(
  async (): Promise<InboundEmailResult> => {
    try {
      const { readEnv } = await import('./env')
      const key = await readEnv('RESEND_API_KEY')
      if (!key) {
        return { items: [], note: RESEND_KEY_MISSING_NOTE }
      }

      const res = await fetch(RESEND_RECEIVING_URL, {
        headers: { Authorization: `Bearer ${key}` },
      })
      // Inbound receiving is a feature that must be enabled for the domain; when
      // it isn't, Resend answers 404/422. Surface the forward-to-admins fallback
      // rather than a generic failure.
      if (res.status === 404 || res.status === 422) {
        return { items: [], note: RESEND_INBOUND_UNAVAILABLE_NOTE }
      }
      if (!res.ok) {
        return { items: [], note: RESEND_FETCH_FAILED_NOTE }
      }
      const payload: unknown = await res.json()
      return { items: shapeInboundEmails(payload), note: null }
    } catch {
      return { items: [], note: RESEND_FETCH_FAILED_NOTE }
    }
  },
)
