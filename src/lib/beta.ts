/**
 * Beta messaging copy. Souso is open (sign-ups are NOT gated, see #407) but we
 * want every new user to understand they're an early beta tester: expect rough
 * edges, and tell us what breaks. Kept here as a single source of truth so the
 * landing hero, the onboarding intro, and any first-run note all read the same
 * line. Pure data, no React, so it's safe to import anywhere.
 */

/** The label shown in the small "Beta" tag by the wordmark / in the app chrome. */
export const BETA_LABEL = 'Beta'

/**
 * The one-line note shown at sign-up / first run. Tasteful, not naggy: states
 * the beta, frames the user as an early tester, sets the rough-edges
 * expectation, and invites feedback (pairs with the feedback CTA, #404).
 */
export const BETA_NOTE =
  "Souso is in beta, you're one of our first testers. Expect a few rough edges, and tell us what breaks."
