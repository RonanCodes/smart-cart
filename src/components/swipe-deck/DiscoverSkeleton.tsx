import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { Skeleton } from '#/components/ui/skeleton'

/**
 * DiscoverSkeleton — the /discover route's pendingComponent (#229). Discover is
 * currently a static placeholder (the swipe deck lands in a later slice), so this
 * skeleton mainly future-proofs the route: it holds a centred card-shaped frame
 * (the recipe deck's eventual shape) so when the deck's data read arrives the
 * skeleton already mirrors the layout. The header text matches the live page so
 * only the card animates in.
 */
export function DiscoverSkeleton() {
  return (
    <AppShell>
      <ScreenHeader
        title="Discover"
        subtitle="Swipe through dinners to teach Souso your taste."
      />
      <div
        className="flex flex-col items-center px-5 pt-6"
        aria-busy="true"
        aria-label="Loading the recipe deck"
      >
        <div className="bg-card border-border w-full max-w-sm overflow-hidden rounded-2xl border shadow-sm">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="flex flex-col gap-2 px-4 py-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <div className="mt-6 flex gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <Skeleton className="h-14 w-14 rounded-full" />
        </div>
      </div>
    </AppShell>
  )
}
