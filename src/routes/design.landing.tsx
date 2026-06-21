import { createFileRoute } from '@tanstack/react-router'
import { Landing } from '#/components/marketing/Landing'
import { DesignBadge } from '#/components/design/design-badge'

/**
 * DESIGN PREVIEW (throwaway) — /design/landing. Renders the marketing Landing
 * with its auth links repointed INTO the prototype (so "Get started" / "Log in"
 * continue to /design/onboarding instead of jumping to the real sign-in). Delete
 * with the design.* routes before shipping.
 */
export const Route = createFileRoute('/design/landing')({
  component: DesignLanding,
})

function DesignLanding() {
  return (
    <>
      <Landing
        launched
        signInTo="/design/onboarding"
        loginTo="/design/onboarding"
      />
      <DesignBadge />
    </>
  )
}
