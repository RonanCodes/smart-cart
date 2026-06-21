import * as Sentry from '@sentry/react'
import posthog from 'posthog-js'
import {
  SENTRY_DSN,
  POSTHOG_KEY,
  POSTHOG_HOST,
  OBSERVABILITY_ENABLED,
} from '#/config/observability'
import type { SessionLike } from './observability-user'
import { toObservabilityUser } from './observability-user'

/**
 * Browser observability: Sentry (errors) + PostHog (product analytics + session
 * replay), initialised once on the client, and LINKED so one signal gives a full
 * trace across both tools.
 *
 * The link (the bit the user asked for): after PostHog loads we take its
 * `distinct_id` and set it as the Sentry user id + a `posthog_distinct_id` tag,
 * and attach the PostHog session-replay URL as a Sentry tag. So from a Sentry
 * error you can jump straight to that user's PostHog session replay, and a
 * PostHog person carries the same id Sentry grouped on.
 *
 * `log.ts` forwards `log.error`/`log.warn`/events into these as sinks, so call
 * sites keep using `log.*` and the backends stay swappable.
 */
let started = false

export function initObservability(): void {
  if (started || !OBSERVABILITY_ENABLED) return
  started = true

  Sentry.init({
    dsn: SENTRY_DSN,
    // Conservative sampling for a side project; raise if you want more traces.
    tracesSampleRate: 0.2,
    sendDefaultPii: false,
    environment: 'production',
  })

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    // Session replay so a Sentry error links to a watchable session.
    disable_session_recording: false,
    loaded: (ph) => {
      const distinctId = ph.get_distinct_id()
      if (distinctId) {
        Sentry.setUser({ id: distinctId })
        Sentry.setTag('posthog_distinct_id', distinctId)
      }
      // Attach the replay URL to every Sentry event for one-click pivot.
      try {
        const replayUrl = ph.get_session_replay_url()
        if (replayUrl) Sentry.setTag('posthog_replay_url', replayUrl)
      } catch {
        // get_session_replay_url is best-effort; ignore if unavailable.
      }
    },
  })
}

/**
 * Set (or clear) the Sentry user from the auth session, so every client event
 * shows WHO hit it instead of being anonymous. Call with the resolved session
 * when signed in, and with `null` on sign-out / the signed-out state.
 *
 * We keep the PostHog `distinct_id` Sentry already grouped on (set in `init`'s
 * `loaded` callback) and layer the email on top, so an error still pivots to the
 * session replay AND shows the email. A signed-out call clears to anonymous but
 * preserves the distinct_id link if PostHog had set one.
 */
export function setObservabilityUser(
  session: SessionLike | null | undefined,
): void {
  if (!started) return
  const user = toObservabilityUser(session)
  if (!user) {
    // Signed out: drop email/id but keep the PostHog distinct_id link if any,
    // so an anonymous error still reaches the right session replay.
    const distinctId = posthog.get_distinct_id()
    Sentry.setUser(distinctId ? { id: distinctId } : null)
    return
  }
  const distinctId = posthog.get_distinct_id()
  Sentry.setUser({
    // Prefer the real user id; fall back to the PostHog distinct_id link.
    id: user.id || distinctId,
    email: user.email || undefined,
  })
}

/** Forward an error to Sentry (called by log.ts). No-op until init. */
export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!started) return
  Sentry.captureException(error, context ? { extra: context } : undefined)
}

/** Forward a named event to PostHog (called by log.ts). No-op until init. */
export function captureEvent(
  event: string,
  props?: Record<string, unknown>,
): void {
  if (!started) return
  posthog.capture(event, props)
}
