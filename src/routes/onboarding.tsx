import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import { SafeArea } from '#/components/ui/safe-area'
import { OnboardingFlow } from '#/components/onboarding/onboarding-flow'
import { OnboardingSkeleton } from '#/components/onboarding/OnboardingSkeleton'
import { completeOnboarding, hasHousehold } from '#/lib/onboarding-server'
import type { OnboardingDraft } from '#/components/onboarding/form-state'

export const Route = createFileRoute('/onboarding')({
  beforeLoad: requireUserBeforeLoad,
  // Read whether the signed-in user already has a household (a 'redo onboarding'
  // re-entry vs a fresh run). The loader runs on the server and hydrates first
  // paint (SSR untouched); the component re-reads it through useQuery seeded by
  // this result so flicking back to the route is instant with no refetch (#232,
  // the #230 pattern).
  loader: (): Promise<boolean> => hasHousehold(),
  // Skeleton mirroring the Jow-style step/form shell while the loader resolves
  // (#229/#232). Shows on client navigations and slow loads, not on SSR.
  pendingComponent: OnboardingSkeleton,
  component: Onboarding,
})

/**
 * Onboarding — now a Jow-style multi-step FORM (PRD #104), replacing the swipe
 * deck as the data-collection entry. The form is the data source: the planner
 * filters + ranks from the explicit answers (household, dislikes, diet,
 * equipment, goals, store) rather than inferring from swipes.
 *
 * This route is the flow's host: a full-screen safe-area frame (no tab bar) with
 * the OnboardingFlow shell inside. On finish (#110) it persists the draft to the
 * household + profile, generates the first week from those answers, and routes
 * straight to /week?plan=<id>. The swipe deck code stays in the repo (it may
 * return as a later 'discover' feature) but is no longer the onboarding path.
 */
function Onboarding() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const loaderData = Route.useLoaderData()
  // Cache the household-exists flag under the shared QueryClient (#232) seeded by
  // the loader's server result, so first paint stays SSR and re-entry is instant.
  // A returning household (a 'redo onboarding' re-entry) gets the intro
  // carousel's existing 'I have an account' affordance routing them to sign-in;
  // the form steps + persistence + push-prompt step are untouched.
  const { data: alreadyOnboarded } = useQuery({
    queryKey: ['onboarding', 'has-household'],
    queryFn: hasHousehold,
    initialData: loaderData,
  })

  async function handleComplete(draft: OnboardingDraft) {
    setError(null)
    try {
      const { planId } = await completeOnboarding({ data: { draft } })
      await navigate({ to: '/week', search: { plan: planId } })
    } catch {
      // Keep the user on the form (their answers survive in the flow state) and
      // surface a retry rather than dropping them somewhere blank.
      setError('Could not build your week. Tap "Build my week" to try again.')
    }
  }

  return (
    <SafeArea
      edges={['top', 'bottom', 'left', 'right']}
      className="bg-background mx-auto flex h-[100dvh] w-full max-w-md flex-col overflow-hidden"
    >
      {error && (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive mx-5 mt-4 rounded-lg px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}
      <OnboardingFlow
        onComplete={handleComplete}
        onSignIn={
          alreadyOnboarded
            ? () => {
                window.location.href = '/sign-in'
              }
            : undefined
        }
      />
    </SafeArea>
  )
}
