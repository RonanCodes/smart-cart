import { ShoppingCart } from 'lucide-react'
import { AppShell } from '#/components/ui/app-shell'
import { Skeleton, SkeletonList } from '#/components/ui/skeleton'
import { CartStoreSwitch } from '#/components/shopping/CartStoreSwitch'
import { DEFAULT_STORE, storeLabel } from '#/lib/store-pref-server'

/**
 * ShoppingSkeleton: the /shopping route's pendingComponent (#226, restructured).
 *
 * Instead of a full-screen wash of placeholder boxes, this renders the REAL page
 * chrome immediately in a disabled/loading state (the "Cart" title, the 3-way
 * store switch, and the floating "Order at <store>" bar) so the layout is stable
 * the instant the route is entered and only the DATA area (the item rows) shimmers
 * while the loader runs. When the real data lands, the chrome is already in place,
 * so nothing jumps; only the rows swap from shimmer to content.
 *
 * The chrome here is non-interactive: the store switch shows its real spinner
 * cells (CartStoreSwitch in `loading` with no data), and the order bar is a
 * disabled mirror of FloatingOrderBar's layout (no price, no server calls).
 */
export function ShoppingSkeleton() {
  return (
    <AppShell>
      {/* Real header chrome: the "Cart" title + the store switch, matching the
          live page so it doesn't shift when data arrives. */}
      <header className="px-5 pt-4 pb-2">
        <h1 className="text-[2rem] leading-tight font-bold tracking-[-0.035em]">
          Cart
        </h1>
        <div className="mt-3">
          <CartStoreSwitch
            data={null}
            loading
            selected={DEFAULT_STORE}
            onSelect={() => {}}
          />
        </div>
        <Skeleton className="mt-3 h-4 w-2/3" />
      </header>

      {/* Only the DATA area shimmers: the editable item rows while the loader
          resolves the consolidated list. */}
      <div
        className="px-5 pt-3"
        aria-busy="true"
        aria-label="Loading your shopping list"
      >
        <SkeletonList rows={7} />
      </div>

      {/* The floating order bar, in place but disabled (same position + shape as
          the live FloatingOrderBar) so the chrome never reflows. */}
      <div className="fixed bottom-[calc(var(--tab-bar-space)+0.75rem)] left-1/2 z-40 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2">
        <div className="bg-card/95 border-border rounded-2xl border p-3 shadow-lg backdrop-blur">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-5 w-14" />
          </div>
          <button
            type="button"
            disabled
            aria-hidden
            tabIndex={-1}
            className="bg-primary text-primary-foreground flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold opacity-60 shadow-md"
          >
            <ShoppingCart className="h-5 w-5" aria-hidden />
            <span>Order at {storeLabel(DEFAULT_STORE)}</span>
          </button>
        </div>
      </div>
    </AppShell>
  )
}
