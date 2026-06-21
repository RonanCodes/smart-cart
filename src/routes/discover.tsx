import { createFileRoute } from '@tanstack/react-router'
import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { DiscoverSkeleton } from '#/components/swipe-deck/DiscoverSkeleton'
import { DiscoverFeed } from '#/components/discover/DiscoverFeed'

export const Route = createFileRoute('/discover')({
  // Reuse the loader result on back-nav within 30s (#251).
  staleTime: 30_000,
  // Skeleton while a loader resolves (#229). The feed itself fetches client-side
  // (lazy, on mount) and shows its own loading skeleton, so this only fires for a
  // future loader; harmless to keep wired.
  pendingComponent: DiscoverSkeleton,
  component: Discover,
})

/**
 * Discover tab — a personalized, source-cited "ideas" feed (#Cala). A scrollable
 * stack of cards tailored to the household's profile (in-season produce, a
 * nutrition fact, a cuisine spotlight, a fun food fact), each grounded in real
 * cited web knowledge from Cala (cala.ai), never a hallucination.
 *
 * The feed hides itself entirely when Cala is unconfigured or the household isn't
 * onboarded, so the screen degrades to just its header in that case.
 */
function Discover() {
  return (
    <AppShell>
      <ScreenHeader
        title="Discover"
        subtitle="Ideas about food, health, and what's good to cook right now, tailored to your household."
      />
      <DiscoverFeed />
    </AppShell>
  )
}
