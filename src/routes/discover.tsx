import { createFileRoute, Link } from '@tanstack/react-router'
import { Compass } from 'lucide-react'
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import { Button } from '#/components/ui/button'
import { DiscoverSkeleton } from '#/components/swipe-deck/DiscoverSkeleton'

export const Route = createFileRoute('/discover')({
  // Skeleton while a loader resolves (#229). Discover is a static placeholder
  // today (no loader, so this never fires yet), but wiring the pendingComponent
  // now means the swipe deck slice only has to add its data read, the loading
  // shape is already in place and mirrors the eventual deck card.
  pendingComponent: DiscoverSkeleton,
  component: Discover,
})

/**
 * Discover tab — placeholder for the swipe-first recipe deck (PRD #87). Stubbed
 * here so the tab bar has a real destination; the deck lands in a later slice.
 */
function Discover() {
  return (
    <AppShell>
      <ScreenHeader
        title="Discover"
        subtitle="Swipe through dinners to teach Souso your taste."
      />
      <EmptyState
        icon={<Compass aria-hidden />}
        title="The recipe deck is on its way"
        hint="Soon you'll swipe right on dinners you'd cook and left on the ones you'd skip. For now, jump into your week."
        action={
          <Link to="/week">
            <Button size="pill">Go to my week</Button>
          </Link>
        }
      />
    </AppShell>
  )
}
