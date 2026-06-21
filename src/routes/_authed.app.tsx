import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Retired pre-plan home (#268). /app used to be a manual "Plan my week" card
 * plus the taste profile, sitting in front of the real meal plan. /week now
 * auto-plans when none exists and shows the 7 recipe cards, so the pre-plan
 * screen was a dead-end; the taste profile moved to the Profile tab.
 *
 * This route is kept only as a redirect so any old bookmark / deep link still
 * lands somewhere useful. The redirect runs in `beforeLoad`, before any page
 * renders. The `_authed` layout still guards auth + onboarding upstream.
 */
export const Route = createFileRoute('/_authed/app')({
  beforeLoad: () => {
    throw redirect({ to: '/week' })
  },
})
