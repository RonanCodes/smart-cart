import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { requireAdminBeforeLoad } from '#/lib/admin-server'
import { SafeArea } from '#/components/ui/safe-area'
import { OnboardingFlow } from '#/components/onboarding/onboarding-flow'

/**
 * DESIGN PREVIEW (throwaway) — /design/onboarding. The real OnboardingFlow (now
 * opening on the Souso welcome board), but with no auth / loader / persistence:
 * "Build my week" and "I have an account" both land on the /design/week
 * prototype so the whole demo runs start-to-finish without the loader-backed
 * routes. Delete with the design.* routes before shipping.
 */
export const Route = createFileRoute('/design/onboarding')({
  beforeLoad: requireAdminBeforeLoad,
  component: DesignOnboarding,
})

function DesignOnboarding() {
  const navigate = useNavigate()
  const toWeek = () => void navigate({ to: '/design/week' })
  return (
    <SafeArea
      edges={['top', 'bottom', 'left', 'right']}
      className="bg-background mx-auto flex h-[100dvh] w-full max-w-md flex-col overflow-hidden"
    >
      <OnboardingFlow onComplete={toWeek} onSignIn={toWeek} />
    </SafeArea>
  )
}
