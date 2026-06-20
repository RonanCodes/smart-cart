import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { Skeleton, SkeletonList } from '#/components/ui/skeleton'

/**
 * ShoppingSkeleton — the /shopping route's pendingComponent (#226). Holds the
 * frame (shell, large title, a quiet waste line, the editable list, the cart
 * deep-link buttons) while the loader runs. The shopping loader can auto-seed the
 * list from the week, which is a touch slower, so a skeleton here is the most
 * visible win in the slice.
 */
export function ShoppingSkeleton() {
  return (
    <AppShell>
      <ScreenHeader
        title="Shopping"
        subtitle="One list for the week, with the exact amount you need."
      />
      <div
        className="px-5 pt-3"
        aria-busy="true"
        aria-label="Loading your shopping list"
      >
        <Skeleton className="h-4 w-2/3" />
        <SkeletonList className="mt-4" rows={7} />
        <div className="mt-6 flex gap-3">
          <Skeleton className="h-12 flex-1 rounded-full" />
          <Skeleton className="h-12 flex-1 rounded-full" />
        </div>
      </div>
    </AppShell>
  )
}
