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
import { getClientTraceId } from './trace'
import {
  isIgnorableNetworkError,
  shouldDropSentryEvent,
} from './ignorable-error'

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

/**
 * Souso branding + plain-voice copy for the Sentry user-feedback integration.
 *
 * We keep the `feedbackIntegration` REGISTERED (so the SDK's feedback API stays
 * available) but `autoInject: false` so it does NOT inject its own bottom-right
 * button (#feedback-redesign). The visible feedback trigger is now our own FAB
 * in the bottom tab bar, which opens our `FeedbackForm` and routes the message
 * through `captureSentryFeedback` below. The theme here is kept only for reuse.
 *
 * Pure + exported so the config (brand colours + copy) is unit-testable without
 * booting Sentry. The theme maps the brand palette: forest green text on cream
 * surfaces, mustard accent on the trigger + submit button.
 */
export function sousoFeedbackOptions() {
  return {
    // We render our OWN feedback trigger (the tab-bar FAB) + form, so the
    // integration must not auto-inject its bottom-right button. Keep it
    // registered (the SDK feedback API stays available) but invisible.
    autoInject: false,
    // Brand, not Sentry: hide Sentry's own branding line.
    showBranding: false,
    // Email: prefilled from the signed-in user (Sentry.setUser → useSentryUser
    // default), and shown so a SIGNED-OUT tester can still leave one. Optional
    // either way (a quick note never needs it). Name stays hidden.
    showName: false,
    showEmail: true,
    isNameRequired: false,
    isEmailRequired: false,
    // Let testers attach a screenshot of what they're reporting (native Sentry
    // capture; lazy-loaded). Asked for explicitly — a picture beats a paragraph.
    enableScreenshot: true,
    // Plain Souso voice (no AI-tell, no dashes).
    triggerLabel: 'Feedback',
    triggerAriaLabel: 'Send feedback to Souso',
    formTitle: 'Tell us what you think',
    messageLabel: 'Your feedback',
    messagePlaceholder:
      "What's working, what's not, what you'd love next? Up for a quick chat? Drop your number or WhatsApp and we'll reach out, you'd be shaping Souso directly.",
    submitButtonLabel: 'Send feedback',
    cancelButtonLabel: 'Not now',
    successMessageText: 'Thank you, we read every note.',
    // Brand palette (styles.css): cream surfaces, forest-green text, mustard
    // accent. Set on both schemes so it stays on-brand in light or dark.
    colorScheme: 'light' as const,
    themeLight: {
      background: '#f6f2e8',
      foreground: '#16341f',
      accentBackground: '#e8a33d',
      accentForeground: '#16341f',
      successColor: '#6f9135',
      boxShadow: '0 6px 24px -8px rgba(22,52,31,0.35)',
      outline: '1px auto #e8a33d',
    },
    themeDark: {
      background: '#16341f',
      foreground: '#f1ede0',
      accentBackground: '#e8a33d',
      accentForeground: '#1a1405',
      successColor: '#8bb04a',
      boxShadow: '0 6px 24px -8px rgba(0,0,0,0.5)',
      outline: '1px auto #e8a33d',
    },
  }
}

export function initObservability(): void {
  if (started || !OBSERVABILITY_ENABLED) return
  started = true

  Sentry.init({
    dsn: SENTRY_DSN,
    // Conservative sampling for a side project; raise if you want more traces.
    tracesSampleRate: 0.2,
    sendDefaultPii: false,
    environment: 'production',
    // Register the feedback integration with `autoInject: false` so the SDK's
    // feedback API (captureFeedback) is available, but it does NOT inject its own
    // bottom-right button — our tab-bar FAB + FeedbackForm is the visible trigger
    // now (#feedback-redesign). Guarded: if the integration isn't available in
    // this SDK build, we skip it rather than crash init.
    integrations: (() => {
      try {
        return typeof Sentry.feedbackIntegration === 'function'
          ? [Sentry.feedbackIntegration(sousoFeedbackOptions())]
          : []
      } catch {
        return []
      }
    })(),
    // Drop benign server-fn network/abort blips (SOUSO-A/Y/X, #417). The Sentry
    // browser SDK also auto-captures unhandled rejections from createServerFn's
    // fetch, so the filter belongs here as well as in captureError.
    beforeSend: (event) => (shouldDropSentryEvent(event) ? null : event),
  })

  // The per-session trace id (diagnose canon): tag every Sentry event with it and
  // register it as a PostHog super-property so it rides on every event. Combined
  // with the same id on `log.*` lines + the `/api/log` server re-emit, ONE value
  // reconstructs a flow across logs, Sentry, and PostHog. Guarded: never throws.
  let traceId = ''
  try {
    traceId = getClientTraceId()
    Sentry.setTag('trace_id', traceId)
  } catch {
    // trace id is best-effort; an error without it still reports.
  }

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
      // The trace id rides on every PostHog event too, so a funnel event lines up
      // with the same flow's Sentry error + Workers Logs line.
      try {
        if (traceId) ph.register({ trace_id: traceId })
      } catch {
        // register is best-effort; ignore if unavailable.
      }
    },
  })
}

/**
 * Describe the SHAPE of a route's loader data (keys + value-types, never the
 * values) for a Sentry breadcrumb / route context. The worst post-launch issues
 * were undefined route/loader data on /week with no clue what the loader returned;
 * this captures exactly that without leaking recipe data or PII. Pure + exported
 * so it is unit-testable without booting Sentry.
 */
export function loaderDataShape(data: unknown): Record<string, unknown> {
  try {
    if (data === null) return { type: 'null' }
    if (data === undefined) return { type: 'undefined' }
    if (Array.isArray(data)) return { type: 'array', length: data.length }
    if (typeof data === 'object') {
      const keys = Object.keys(data)
      const types: Record<string, string> = {}
      for (const k of keys) {
        const v = (data as Record<string, unknown>)[k]
        types[k] = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v
      }
      return { type: 'object', keys, types }
    }
    return { type: typeof data }
  } catch {
    return { type: 'unknown' }
  }
}

/**
 * Record the active route + the shape of its loader data, as both a Sentry tag
 * (`route`) and a breadcrumb. So when /week (or any route) throws, the issue shows
 * WHICH route and WHAT the loader handed it — the exact context the undefined
 * route/loader-data crashes were missing. No-op until init. Never throws.
 */
export function setRouteContext(route: string, loaderData?: unknown): void {
  if (!started) return
  try {
    Sentry.setTag('route', route)
    Sentry.addBreadcrumb({
      category: 'route',
      message: route,
      level: 'info',
      data:
        loaderData === undefined
          ? undefined
          : { loader: loaderDataShape(loaderData) },
    })
  } catch {
    // Observability must never crash a request (diagnose canon).
  }
}

/**
 * Drop a Sentry breadcrumb for a key user action (build-week clicked, recipe
 * swap, cart open, checkout start, order placed, OTP requested/verified). The
 * trail of breadcrumbs makes a later error self-explanatory: you see the steps
 * that led to it. Called by `analytics.track` for every funnel event, and
 * directly at action edges that aren't funnel steps. No-op until init; never
 * throws.
 */
export function addBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!started) return
  try {
    Sentry.addBreadcrumb({
      category: 'user-action',
      message,
      level: 'info',
      ...(data ? { data } : {}),
    })
  } catch {
    // Observability must never crash a request (diagnose canon).
  }
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

/**
 * Rebuild a real Error from whatever was logged. `log.ts` serialises thrown
 * values to a plain `{ name, message, stack }` before they reach here, and
 * `Sentry.captureException` on a plain object produces a useless
 * "Object captured as exception with keys: message, name, stack" issue with no
 * message, stack, or grouping. Reconstructing an Error restores the title, stack,
 * and fingerprint so Sentry issues are readable again.
 */
function materialiseError(value: unknown): Error {
  if (value instanceof Error) return value
  if (value && typeof value === 'object') {
    const o = value as { name?: unknown; message?: unknown; stack?: unknown }
    const message =
      typeof o.message === 'string' && o.message
        ? o.message
        : JSON.stringify(value)
    const err = new Error(message)
    if (typeof o.name === 'string' && o.name) err.name = o.name
    if (typeof o.stack === 'string' && o.stack) err.stack = o.stack
    return err
  }
  return new Error(typeof value === 'string' ? value : String(value))
}

/**
 * Forward an error to Sentry (called by log.ts). No-op until init. The dotted
 * `event` name from the log call (e.g. "auth.otp_magiclink_error") is attached as
 * a `log_event` tag so you can filter Sentry by it, and the error is materialised
 * into a real Error so it groups and reads correctly.
 */
export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!started) return
  // Benign server-fn network/abort blips (SOUSO-A/Y/X, #417) are not actionable
  // crashes — drop them at the log.error sink before they reach Sentry, so the
  // real signal isn't buried. `beforeSend` is the backstop for SDK auto-capture.
  if (isIgnorableNetworkError(error)) return
  const event = context?.event
  Sentry.captureException(materialiseError(error), {
    ...(context ? { extra: context } : {}),
    ...(typeof event === 'string' ? { tags: { log_event: event } } : {}),
  })
}

/** A screenshot to attach to a Sentry feedback envelope. */
export interface FeedbackAttachment {
  filename: string
  data: Uint8Array
}

/** The fields our feedback form sends into Sentry User Feedback. */
export interface SentryFeedback {
  message: string
  email?: string | null
  name?: string | null
  phone?: string | null
  attachment?: FeedbackAttachment | null
}

/**
 * Send a piece of user feedback into Sentry User Feedback (the redesigned
 * feedback flow).
 *
 * Why this is shaped the way it is (the #443 follow-up where feedback never
 * landed in Sentry):
 *
 * 1. **Guard on the live Sentry client, not our module-local `started`.** A bare
 *    `if (!started) return` made this a silent no-op in any case where the flag
 *    was false at submit time, even though a Sentry client was live. We ask the
 *    SDK directly (`Sentry.getClient()`); if there is no client (local dev /
 *    pre-init) we skip, otherwise we send.
 * 2. **Mirror the SDK's own `sendFeedback`: set `source` + `url`.** Sentry's
 *    User Feedback ingestion expects the API `source` and the page URL on the
 *    feedback event; `captureFeedback` does NOT add them for you (the SDK's
 *    `sendFeedback` wrapper does). Omitting them is why entries did not show up.
 * 3. **Flush after capture.** `captureFeedback` only queues the envelope; the
 *    panel closes and the user navigates immediately after submit, which can
 *    abandon the in-flight request. `Sentry.flush()` forces the envelope out
 *    before we return. Bounded so a dead network never hangs the UI.
 *
 * Fully guarded — observability must never crash a request, so a failure here is
 * swallowed and the `app_feedback` write (the source of truth) is unaffected.
 * The phone rides as extra feedback context; an optional screenshot rides as a
 * Sentry attachment. Returns a promise that resolves once the flush settles, so
 * the caller can await it before closing the panel.
 *
 * Returns the Sentry event id `captureFeedback` produced, so the server submit
 * can thread it into the admin notification email as a deep-link. Returns null
 * when Sentry is skipped (dev / pre-init) or anything fails — the caller treats
 * a null id as "no Sentry line", never an error.
 */
const FEEDBACK_SOURCE = 'souso-feedback-form'
const FEEDBACK_FLUSH_TIMEOUT_MS = 2000

export async function captureSentryFeedback(
  feedback: SentryFeedback,
): Promise<string | null> {
  try {
    if (typeof Sentry.captureFeedback !== 'function') return null
    // Send whenever a Sentry client is live, regardless of our local flag.
    if (typeof Sentry.getClient === 'function' && !Sentry.getClient())
      return null

    // The page URL the SDK's own `sendFeedback` attaches to a feedback event.
    // `captureFeedback` does not add it for us, so set it explicitly. Best-effort.
    let url: string | undefined
    try {
      url = typeof window !== 'undefined' ? window.location.href : undefined
    } catch {
      url = undefined
    }

    const eventId = Sentry.captureFeedback(
      {
        message: feedback.message,
        source: FEEDBACK_SOURCE,
        ...(url ? { url } : {}),
        ...(feedback.email ? { email: feedback.email } : {}),
        ...(feedback.name ? { name: feedback.name } : {}),
      },
      {
        ...(feedback.attachment
          ? {
              attachments: [
                {
                  filename: feedback.attachment.filename,
                  data: feedback.attachment.data,
                },
              ],
            }
          : {}),
        captureContext: {
          contexts: {
            feedback: { phone: feedback.phone ?? null },
          },
        },
      },
    )

    // Force the feedback envelope out before the panel closes / the user
    // navigates. Bounded so a dead network can never hang the submit.
    if (typeof Sentry.flush === 'function') {
      await Sentry.flush(FEEDBACK_FLUSH_TIMEOUT_MS)
    }
    return typeof eventId === 'string' && eventId ? eventId : null
  } catch {
    // Observability must never crash a request (diagnose canon). The
    // app_feedback DB write is the durable record; Sentry is best-effort.
    return null
  }
}

/** Forward a named event to PostHog (called by log.ts). No-op until init. */
export function captureEvent(
  event: string,
  props?: Record<string, unknown>,
): void {
  if (!started) return
  posthog.capture(event, props)
}
