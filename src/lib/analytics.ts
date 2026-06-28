/**
 * Product-analytics funnel (PostHog) + Sentry breadcrumbs for Souso's core flow.
 *
 * One thin layer over the structured logger so call sites stay declarative:
 *   track(FUNNEL_EVENTS.weekBuilt, { planSize: 7, store: 'ah' })
 *
 * What it does on every call:
 *   - attaches the per-session `traceId` (FE -> BE -> logs -> Sentry -> PostHog),
 *   - strips PII (email/name/address/phone) so analytics never carries it,
 *   - emits via `log.info`, which already fans out to PostHog (`captureEvent`) and
 *     Workers Logs, AND drops a Sentry breadcrumb so a later error shows the trail
 *     of funnel steps that led to it.
 *
 * Observability must never crash a request (diagnose canon): every public fn is
 * wrapped so a telemetry failure is swallowed.
 */
import { getClientTraceId } from './trace'

/**
 * The core conversion funnel. Stable snake_case strings are the PostHog event
 * names (renaming one orphans its historical funnel), so they are frozen here and
 * referenced by the camelCase key everywhere else.
 */
export const FUNNEL_EVENTS = {
  // Auth
  userLoggedIn: 'user_logged_in',
  // Onboarding lifecycle
  onboardingStarted: 'onboarding_started',
  onboardingCompleted: 'onboarding_completed',
  onboardingRestarted: 'onboarding_restarted',
  onboardingStepCompleted: 'onboarding_step_completed',
  emailSubmitted: 'email_submitted',
  // Signup attribution ("How did you find us?"): which channel the user picked.
  signupSource: 'signup_source',
  voiceOnboardingStarted: 'voice_onboarding_started',
  // Planning
  weekBuilt: 'week_built',
  recipeSwapped: 'recipe_swapped',
  recipeOpened: 'recipe_opened',
  // Cart + list
  addedToCart: 'added_to_cart',
  cartUpdated: 'cart_updated',
  storeSelected: 'store_selected',
  // Order + tip
  orderClicked: 'order_clicked',
  tipDialogOpened: 'tip_dialog_opened',
  tipSelected: 'tip_selected',
  ahCartOpened: 'ah_cart_opened',
} as const

export type FunnelEvent = (typeof FUNNEL_EVENTS)[keyof typeof FUNNEL_EVENTS]

/**
 * The shapes of a `cart_updated` event. Each manual edit on the shopping list
 * carries one of these as its `action` prop so the single funnel event can be
 * split by what the user actually did (tick a row in/out, edit its amount,
 * remove it, or the two bulk actions).
 */
export type CartUpdateAction =
  | 'select'
  | 'deselect'
  | 'select_all'
  | 'edit_qty'
  | 'remove'
  | 'clear_all'

/**
 * Keys we NEVER send to PostHog: direct PII. Sentry still carries the user
 * (id+email) via `setObservabilityUser`, which is the single-tenant-operator
 * exception; product analytics stays PII-free regardless.
 */
const PII_KEYS = new Set([
  'email',
  'name',
  'fullName',
  'firstName',
  'lastName',
  'address',
  'phone',
  'phoneNumber',
  'postcode',
  'zip',
])

/** Remove PII keys from an analytics props bag. Never throws; returns a new object. */
export function stripPii(
  props: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!props || typeof props !== 'object') return out
  for (const [k, v] of Object.entries(props)) {
    if (PII_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}

/**
 * Build the final analytics props: PII stripped, with the session `traceId`
 * attached so the event correlates with the logs + Sentry events of the same
 * flow. Never throws.
 */
export function buildEventProps(
  props?: Record<string, unknown> | null,
): Record<string, unknown> & { traceId: string } {
  const safe = stripPii(props)
  let traceId: string
  try {
    traceId = getClientTraceId()
  } catch {
    traceId = ''
  }
  return { ...safe, traceId }
}

/**
 * Emit a funnel event. Forwards through `log.info` (-> PostHog + Workers Logs) and
 * drops a Sentry breadcrumb. PII-stripped, trace-tagged, and fully guarded.
 *
 * `log` and the Sentry breadcrumb helper are imported lazily so this module stays
 * cheap to import from anywhere and the browser-only Sentry SDK never enters the
 * Worker/SSR bundle.
 */
export function track(
  event: FunnelEvent,
  props?: Record<string, unknown>,
): void {
  try {
    const finalProps = buildEventProps(props)
    void import('./log')
      .then(({ log }) => {
        log.info(event, finalProps)
      })
      .catch(() => {
        // telemetry is best-effort
      })
    void import('./observability-client')
      .then(({ addBreadcrumb }) => {
        addBreadcrumb(event, finalProps)
      })
      .catch(() => {
        // breadcrumb is best-effort
      })
  } catch {
    // Observability must never crash a request (diagnose canon).
  }
}
