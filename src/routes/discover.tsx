import { createFileRoute } from '@tanstack/react-router'
import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { DiscoverSkeleton } from '#/components/swipe-deck/DiscoverSkeleton'
import { SearchScreen } from '#/components/discover/SearchScreen'

export const Route = createFileRoute('/discover')({
  // Reuse the loader result on back-nav within 30s (#251).
  staleTime: 30_000,
  // Skeleton while a loader resolves (#229). The screen itself fetches
  // client-side (browse rows on mount, results as you type) and shows its own
  // loading state, so this only fires for a future loader; harmless to keep wired.
  pendingComponent: DiscoverSkeleton,
  component: Search,
})

/**
 * Search tab (path /discover, labelled "Search" in the tab bar). A live search
 * bar over a browse view: before you type, themed horizontal rows of catalogue
 * recipes (each likeable); as you type, it searches recipes AND store products
 * (e.g. "toilet paper") and lets you add a product to the shopping list. All
 * backed by real data — the recipe catalogue (AH/Jumbo + image filter) and the
 * store_product table.
 */
function Search() {
  return (
    <AppShell>
      <ScreenHeader title="Search" />
      <SearchScreen />
    </AppShell>
  )
}
