import { createFileRoute, redirect } from '@tanstack/react-router'
import { hasHousehold } from '#/lib/onboarding-server'
import {
  entryRedirectTarget,
  resolveSessionUserOrNull,
} from '#/lib/route-guards'
import { Landing } from '#/components/marketing/Landing'

/**
 * Public entry (/). Souso is semi-public: the marketing Landing + waitlist is
 * what a signed-out visitor sees (shared on TikTok). NO swipe deck, NO public
 * login button (login is hidden; approved users go to /login directly).
 *
 * Routing (server-side, before the page renders):
 *   - signed-in + onboarded     -> /week (auto-plans + shows recipes)
 *   - signed-in + NOT onboarded -> /onboarding (the Jow form)
 *   - signed out                -> render the Landing
 * The swipe-deck opener is retired (the SwipeDeck component stays in the repo
 * but is no longer routed from /).
 */
export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const user = await resolveSessionUserOrNull()
    const onboarded = user ? await hasHousehold() : false
    const target = entryRedirectTarget({ signedIn: Boolean(user), onboarded })
    if (target) throw redirect({ to: target })
  },
  component: Landing,
})
