import { createServerFn } from '@tanstack/react-start'
import {
  shapeSentryFeedback,
  sentryFeedbackUrl,
  SENTRY_TOKEN_MISSING_NOTE,
  SENTRY_FETCH_FAILED_NOTE,
} from './sentry-admin'
import type { SentryFeedbackResult } from './sentry-admin'

/**
 * Read Sentry user feedback for the admin portal (#458), so the business team
 * can see it without a Sentry login (only Ronan has Sentry access). This is the
 * "use Sentry directly, not our own DB" direction — we query the Sentry API
 * rather than the local app_feedback table.
 *
 * Org `ronan-connolly`, project `souso`, host `de.sentry.io` (our personal EU
 * region — see MEMORY souso-observability), Bearer SENTRY_AUTH_TOKEN via
 * readEnv.
 *
 * Degrades gracefully and NEVER throws (observability/network must not crash a
 * request): an unset token returns an empty list + a "set SENTRY_AUTH_TOKEN"
 * note; a failed/non-200 fetch returns an empty list + a "couldn't reach Sentry"
 * note. The pure response shaping lives in sentry-admin.ts and is unit tested.
 *
 * Server-only: the createServerFn handler body is stripped from the client
 * bundle, and readEnv's `cloudflare:workers` import is dynamic, so nothing
 * server-only leaks. Admin-gated by the /admin route's beforeLoad guard.
 */

const SENTRY_HOST = 'de.sentry.io'
const SENTRY_ORG = 'ronan-connolly'
const SENTRY_PROJECT = 'souso'

export const listSentryFeedback = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SentryFeedbackResult> => {
    try {
      const { readEnv } = await import('./env')
      const token = await readEnv('SENTRY_AUTH_TOKEN')
      if (!token) {
        return { items: [], note: SENTRY_TOKEN_MISSING_NOTE }
      }

      const url = sentryFeedbackUrl({
        host: SENTRY_HOST,
        org: SENTRY_ORG,
        project: SENTRY_PROJECT,
      })
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        return { items: [], note: SENTRY_FETCH_FAILED_NOTE }
      }
      const payload: unknown = await res.json()
      return { items: shapeSentryFeedback(payload), note: null }
    } catch {
      // Network blip, parse error, or env failure: degrade to an empty list with
      // a note rather than 500-ing the admin loader.
      return { items: [], note: SENTRY_FETCH_FAILED_NOTE }
    }
  },
)
