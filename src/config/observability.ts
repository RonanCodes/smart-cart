/**
 * Client-side observability config (Sentry + PostHog) for Souso.
 *
 * The Sentry DSN and the PostHog `phc_` key are BOTH designed to ship in the
 * browser (the DSN only allows sending events; the `phc_` key is the public
 * ingest key), so they live here as committed defaults, with a `VITE_` override
 * per environment. This mirrors `config/vapi.ts` and sidesteps the `.dev.vars`
 * not reaching `import.meta.env` gotcha.
 *
 * Personal ronan-connolly projects (NOT Simplicity): Sentry project `souso`
 * (EU/de region), PostHog project `Souso` (id 206502, EU region).
 */
export const SENTRY_DSN =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined) ??
  'https://9bfd2e79834ed6bc91f1c93bf31ca8ea@o4511243313414144.ingest.de.sentry.io/4511600359178320'

export const POSTHOG_KEY =
  (import.meta.env.VITE_POSTHOG_KEY as string | undefined) ??
  'phc_rBDYeRQ3Tnyfw8mmRGuDTJXuV7RwbyXT6X83WXUnEuCc'

export const POSTHOG_HOST =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ??
  'https://eu.i.posthog.com'

/** Only send telemetry from the deployed app, not local dev. */
export const OBSERVABILITY_ENABLED =
  typeof window !== 'undefined' && import.meta.env.PROD
