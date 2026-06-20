import { createFileRoute } from '@tanstack/react-router'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import { SafeArea } from '#/components/ui/safe-area'
import { OnboardingFlow } from '#/components/onboarding/onboarding-flow'
import type { OnboardingDraft } from '#/components/onboarding/form-state'

export const Route = createFileRoute('/onboarding')({
  beforeLoad: requireUserBeforeLoad,
  component: Onboarding,
})

/**
 * Onboarding — now a Jow-style multi-step FORM (PRD #104), replacing the swipe
 * deck as the data-collection entry. The form is the data source: the planner
 * filters + ranks from the explicit answers (household, dislikes, diet,
 * equipment, goals, store) rather than inferring from swipes.
 *
 * This route is the flow's host: a full-screen safe-area frame (no tab bar) with
 * the OnboardingFlow shell inside. Final persistence + week generation is wired
 * in #110 via `onComplete`; the swipe deck code stays in the repo (it may return
 * as a later 'discover' feature) but is no longer the onboarding path.
 */
function Onboarding() {
  function handleComplete(_draft: OnboardingDraft) {
    // #110 will persist `_draft` (household + profile) and generate the week.
    // Until then the flow is navigable end-to-end and lands back at the app.
    window.location.href = '/app'
  }

  return (
    <SafeArea
      edges={['top', 'bottom', 'left', 'right']}
      className="bg-background mx-auto flex w-full max-w-md flex-col"
    >
      <OnboardingFlow onComplete={handleComplete} />
    </SafeArea>
  )
}
