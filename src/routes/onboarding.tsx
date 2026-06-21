import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SafeArea } from '#/components/ui/safe-area'
import { OnboardingFlow } from '#/components/onboarding/onboarding-flow'
import { OnboardingSkeleton } from '#/components/onboarding/OnboardingSkeleton'
import { completeOnboarding, hasHousehold } from '#/lib/onboarding-server'
import type { OnboardingDraft } from '#/components/onboarding/form-state'
import { track, FUNNEL_EVENTS } from '#/lib/analytics'

/**
 * Resolve the onboarding entry state in ONE server round-trip: is the visitor
 * signed in, and (if so) do they already have a household. EMAIL-LAST design
 * (TJ): /onboarding is now ANONYMOUS — a signed-out visitor runs the whole form
 * and gives their email at the END (the OnboardingFlow `auth` phase creates the
 * account on OTP verify). A signed-in visitor is a 'redo onboarding' re-entry, so
 * they skip the email phase. Fails open to signed-out so a transient session
 * error still lets the public form render.
 */
const resolveOnboardingEntry = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ signedIn: boolean; onboarded: boolean }> => {
    const { getSessionUser } = await import('#/lib/server-auth')
    const user = await getSessionUser()
    if (!user) return { signedIn: false, onboarded: false }
    return { signedIn: true, onboarded: await hasHousehold() }
  },
)

export const Route = createFileRoute('/onboarding')({
  // NO auth gate (TJ's email-last design): a signed-out visitor must be able to
  // run the whole form anonymously and give their email at the end. The flow's
  // terminal `auth` phase creates + authenticates the account before
  // completeOnboarding runs (which needs the session cookie it sets).
  loader: (): Promise<{ signedIn: boolean; onboarded: boolean }> =>
    resolveOnboardingEntry(),
  // Skeleton mirroring the Jow-style step/form shell while the loader resolves
  // (#229/#232). Shows on client navigations and slow loads, not on SSR.
  pendingComponent: OnboardingSkeleton,
  component: Onboarding,
})

/**
 * Onboarding — a Jow-style multi-step FORM (PRD #104), the data-collection entry
 * for the planner. The form is the data source: the planner filters + ranks from
 * the explicit answers (household, dislikes, diet, equipment, goals, store).
 *
 * EMAIL-LAST: a signed-out visitor runs every step, then an email/OTP phase
 * creates their account; only then does completeOnboarding persist the household
 * + build the first week and route to /week?plan=<id>. A signed-in redo skips the
 * email phase (`requireAuth={false}`) and persists straight away.
 */
function Onboarding() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const loaderData = Route.useLoaderData()
  // Cache the entry state under the shared QueryClient (#232) seeded by the
  // loader's server result, so first paint stays SSR and re-entry is instant.
  const { data: entry } = useQuery({
    queryKey: ['onboarding', 'entry'],
    queryFn: resolveOnboardingEntry,
    initialData: loaderData,
  })

  async function handleComplete(draft: OnboardingDraft) {
    setError(null)
    try {
      // By the time this runs the user is authenticated: a signed-in redo already
      // had a session; a signed-out visitor just verified their OTP, which set
      // the session cookie. So completeOnboarding's getSessionUser resolves.
      const { planId } = await completeOnboarding({ data: { draft } })
      // First week built from onboarding: the activation moment. Non-PII props.
      track(FUNNEL_EVENTS.weekBuilt, {
        source: 'onboarding',
        householdSize: (draft.adults || 0) + (draft.children || 0),
        store: draft.store,
      })
      await navigate({ to: '/week', search: { plan: planId } })
    } catch {
      // Keep the user on the form (their answers survive in the flow state +
      // sessionStorage) and surface a retry rather than dropping them blank.
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
        // A signed-in visitor is redoing onboarding: they already have a session,
        // so skip the email/OTP phase. A signed-out visitor must create their
        // account at the end, so the email phase runs.
        requireAuth={!entry.signedIn}
        // 'I have an account' on the welcome board routes a signed-out visitor to
        // sign-in. A signed-in redo has no use for it.
        onSignIn={
          entry.signedIn
            ? undefined
            : () => {
                window.location.href = '/sign-in'
              }
        }
      />
    </SafeArea>
  )
}
