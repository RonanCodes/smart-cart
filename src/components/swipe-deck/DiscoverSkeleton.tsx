import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { Skeleton } from '#/components/ui/skeleton'

/**
 * DiscoverSkeleton — the /discover (Search) route's pendingComponent (#229).
 * The Search screen fetches client-side (browse rows on mount, results as you
 * type), so this only fires for a future loader. The header text matches the
 * live page ("Search") so only the body animates in.
 */
export function DiscoverSkeleton() {
  return (
    <AppShell>
      <ScreenHeader title="Search" />
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
