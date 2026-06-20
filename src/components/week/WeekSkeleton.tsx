import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { SkeletonCard } from '#/components/ui/skeleton'

/**
 * WeekSkeleton — the /week route's pendingComponent (#226). Holds the real
 * page's frame (shell, large title, seven stacked day cards) while the loader
 * runs, so navigating to the week shows its shape immediately instead of a blank
 * screen, and navigating back is instant once the data is cached. The header text
 * matches the live page so only the cards animate in.
 */
export function WeekSkeleton() {
  return (
    <AppShell>
      <ScreenHeader
        title="Your week"
        subtitle="Seven dinners, one per day. Swap any day or tell us what changed."
      />
      <div
        className="grid grid-cols-1 gap-4 px-5 pt-2"
        aria-busy="true"
        aria-label="Loading your week"
      >
        {Array.from({ length: 7 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </AppShell>
  )
}
