import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Leaf, ShoppingBag, Sparkles } from 'lucide-react'
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import { Button } from '#/components/ui/button'
import { loadShoppingBootstrap } from '#/lib/shopping-server'
import type { ShoppingBootstrap } from '#/lib/shopping-server'
import { EditableShoppingList } from '#/components/shopping/EditableShoppingList'
import { StaplesSection } from '#/components/shopping/StaplesSection'
import { CartStoreSwitch } from '#/components/shopping/CartStoreSwitch'
import { FloatingOrderBar } from '#/components/shopping/FloatingOrderBar'
import { ShoppingSkeleton } from '#/components/shopping/ShoppingSkeleton'
import type { ShoppingItem } from '#/lib/shopping'
import type { StapleLine } from '#/lib/staples-server'
import { deriveLiveCartSet } from '#/lib/shopping/cart-set'
import type { CartExtra } from '#/lib/shopping/cart-set'
import {
  priceMapForStore,
  usePriceComparison,
} from '#/lib/use-price-comparison'
import { effectiveStore } from '#/lib/store-pref-server'
import type { StoreSlug } from '#/lib/store-pref-server'
import { track, FUNNEL_EVENTS } from '#/lib/analytics'

interface ShoppingSearch {
  /** Optional plan id, set when arriving from the week view's "Shopping list". */
  plan?: string
}

export const Route = createFileRoute('/_authed/shopping')({
  validateSearch: (search: Record<string, unknown>): ShoppingSearch => ({
    plan: typeof search.plan === 'string' ? search.plan : undefined,
  }),
  // Auth + onboarding run ONCE in the shared `_authed` layout (#251); this route
  // no longer re-fires the two guard server fns in its own beforeLoad.
  // Reuse the loader result on back-nav within 30s (#251). Default route
  // staleTime is 0, so coming back to /shopping always re-ran the (5-call) fan-out.
  staleTime: 30_000,
  loaderDeps: ({ search }) => ({ plan: search.plan }),
  loader: ({ deps }): Promise<ShoppingBootstrap> =>
    // ONE round-trip (#251): loadShoppingBootstrap composes loadShoppingList +
    // staples + frequently-bought + saved items + store server-side. The cart is
    // never auto-seeded — items land only via the week view's "Add to shopping
    // list", so a deliberate "Clear all" stays cleared with no URL flag.
    loadShoppingBootstrap({
      data: { planId: deps.plan },
    }),
  // Skeleton while the loader resolves (#226). SSR is untouched: the loader runs
  // server-side and hydrates first paint; the skeleton only shows on client
  // navigations and slow loads.
  pendingComponent: ShoppingSkeleton,
  component: Shopping,
})

/**
 * Cart tab — the week's recipes turned into ONE consolidated, editable cart with
 * exact amounts (slice #79, PRD #77; redesigns #178, #cart-align).
 *
 * The screen now reads as a single cart aligned to the design prototype:
 *  - a heading "Cart" with a 3-way store switch (Albert Heijn / Jumbo / Picnic),
 *    each showing that store's REAL basket total from the price comparison;
 *  - the merged-from-N-recipes + ingredients-reused notes;
 *  - airy hairline aisle groups (Produce, Dairy & cheese, ...) of die-cut
 *    ingredient stickers, each row showing the SELECTED store's per-item price
 *    and a checkbox;
 *  - "Also on my list" extras / staples below;
 *  - a floating total + "Order at <store>" CTA pinned above the tab bar.
 *
 * Picking a store reprices the whole screen at once (switch total, per-item
 * prices, floating total + order button) from one shared comparison fetch. All
 * the real behaviour is kept: check/uncheck, edit, add, remove, clear, order.
 */
function Shopping() {
  // The loader is typed non-nullable, but a degraded backend could resolve it to
  // null at runtime; widen through `unknown` so the fail-safe guard below is real
  // (a direct `as ShoppingBootstrap | null` is flagged as an unnecessary cast).
  const data = Route.useLoaderData() as unknown as
    | ShoppingBootstrap
    | null
    | undefined

  // Fail-safe (server-hardening): if the loader ever resolves to null/undefined
  // (a backend hiccup degrading gracefully rather than 500-ing), render the
  // graceful empty-cart state instead of destructuring null (which crashed the
  // client with "Cannot destructure property 'view' from null" in Sentry).
  if (!data) return <EmptyCart initialStaples={[]} />

  const {
    view,
    staples: initialStaples,
    items: initialItems,
    preferredStore,
  } = data
  const hasSavedItems = initialItems.length > 0

  // The route OWNS the live list + extras + their selected state (#311), plus the
  // selected store (#cart-align), so the store switch, the per-item prices, the
  // floating total and the order button all recompute together from the SELECTED
  // (in-order) set with no full reload.
  const [liveItems, setLiveItems] = useState<Array<ShoppingItem>>(initialItems)
  const [liveStaples, setLiveStaples] =
    useState<Array<StapleLine>>(initialStaples)
  const [selectedExtraIds, setSelectedExtraIds] = useState<Set<string>>(
    new Set(),
  )
  // Coerce any parked "Coming soon" preference (e.g. a saved 'jumbo') to the
  // default so the switch, pricing and order bar never land on an untested store.
  const [store, setStore] = useState<StoreSlug>(effectiveStore(preferredStore))

  // Switching the cart's store on the Cart screen. This is the "tried to click
  // AH / Picnic / Jumbo" signal (Jumbo is parked, so it never reaches here, but
  // the prop space covers it for when it re-enables). UI call-site, guarded.
  function selectStore(next: StoreSlug) {
    setStore(next)
    track(FUNNEL_EVENTS.storeSelected, { store: next, source: 'cart' })
  }

  // The extras as cart-set shape: a staple's saved slug already carries its
  // store, so selecting it includes it in that store's basket + cart.
  const extras: Array<CartExtra> = useMemo(
    () =>
      liveStaples.map((s) => ({
        id: s.id,
        name: s.name,
        store: s.store,
        slug: s.productSlug,
      })),
    [liveStaples],
  )

  // The single live SELECTED (in-order) set the comparison + cart consume.
  const liveSet = useMemo(
    () => deriveLiveCartSet(liveItems, extras, selectedExtraIds),
    [liveItems, extras, selectedExtraIds],
  )

  // ONE shared price comparison feeds the switch, the per-item prices and the
  // floating bar (#cart-align). The 4 MB catalogue stays server-side.
  const { data: priceData, loading: priceLoading } = usePriceComparison(
    liveSet.compareLines,
  )
  const priceMap = useMemo(
    () => priceMapForStore(priceData, store),
    [priceData, store],
  )

  // "Merged automatically from N recipes": distinct meals the list draws on,
  // counted from the real consolidated lines' usedInMeals (no hardcoding).
  const recipeCount = useMemo(() => {
    const meals = new Set<string>()
    for (const line of view.list.lines)
      for (const meal of line.usedInMeals) meals.add(meal)
    return meals.size
  }, [view.list.lines])

  // A `?plan=` deep-link to a plan that is not in this account: never show the
  // household's own saved list as if it were that week. Offer a way back to the
  // real week, and still let the user start a list from staples (#plan-cart-mismatch).
  if (view.missingPlanId) {
    return (
      <AppShell>
        <ScreenHeader
          title="Cart"
          subtitle="This meal plan is not in your account."
        />
        <EmptyState
          icon={<ShoppingBag aria-hidden />}
          title="Plan not found"
          hint="That week belongs to another account or was removed. Open your week from the Week tab, or start a list from staples below."
          action={
            <Link to="/week">
              <Button size="pill">Go to my week</Button>
            </Link>
          }
        />
        <div className="px-5 pt-6 pb-4">
          <StaplesSection initialStaples={initialStaples} />
        </div>
      </AppShell>
    )
  }

  // Nothing to shop for yet: no saved rows and no staples. The bare empty
  // state, but still let the user start a list from staples alone (a top-up
  // shop without a meal plan).
  if (!hasSavedItems && initialStaples.length === 0) {
    return <EmptyCart initialStaples={initialStaples} />
  }

  return (
    <AppShell>
      <header className="px-5 pt-4 pb-2">
        <h1 className="text-[2rem] leading-tight font-bold tracking-[-0.035em]">
          Cart
        </h1>

        {/* Store switch — the same basket priced across the three stores, real
            totals from the comparison. Picking one reprices the whole screen. */}
        {hasSavedItems && (
          <div className="mt-3">
            <CartStoreSwitch
              data={priceData}
              loading={priceLoading}
              selected={store}
              onSelect={selectStore}
            />
          </div>
        )}

        {/* The merged / reused notes, from the real consolidated view. */}
        {recipeCount > 0 && (
          <p className="text-muted-foreground mt-3 flex items-center gap-1.5 text-xs">
            <Sparkles
              className="text-primary h-3.5 w-3.5 shrink-0"
              aria-hidden
            />
            Merged automatically from {recipeCount}{' '}
            {recipeCount === 1 ? 'recipe' : 'recipes'}
          </p>
        )}
        {view.waste.hasSavings && view.waste.sharedIngredientCount > 0 && (
          <p className="text-primary/90 mt-2 flex items-center gap-1.5 text-xs font-medium">
            <Leaf className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {view.waste.sharedIngredientCount}{' '}
            {view.waste.sharedIngredientCount === 1
              ? 'ingredient'
              : 'ingredients'}{' '}
            reused, nothing left over
            {view.amountsEstimated && ' (amounts approx)'}
          </p>
        )}
      </header>

      {/* The week's recipe ingredients WITH amounts, the primary editable list,
          grouped into airy hairline aisle sections with the selected store's
          per-item price per row. Select, rename, re-amount, add, remove all
          survive a reload; state mirrors up so the totals + cart recompute on a
          tick. */}
      {hasSavedItems && (
        <div className="px-5 pt-3 pb-2">
          <EditableShoppingList
            initialItems={initialItems}
            onItemsChange={setLiveItems}
            priceMap={priceMap}
          />
        </div>
      )}

      {/* "Also on my list" extras / staples. A selected extra joins the basket +
          cart (#311). */}
      <div className="px-5 pt-2 pb-2">
        <StaplesSection
          initialStaples={initialStaples}
          onStaplesChange={setLiveStaples}
          onCheckedChange={setSelectedExtraIds}
        />
      </div>

      {/* Clear the floating order bar at the bottom of the scroll. */}
      <div aria-hidden className="h-32" />

      {/* Floating total + "Order at <store>" CTA, pinned above the tab bar. Reads
          the SELECTED store's real total, sends the SELECTED (in-order) set to
          its cart. */}
      {hasSavedItems && (
        <FloatingOrderBar
          store={store}
          data={priceData}
          compareLines={liveSet.compareLines}
          extras={extras.filter((e) => selectedExtraIds.has(e.id))}
        />
      )}
    </AppShell>
  )
}

/**
 * The graceful empty-cart screen — "Your cart is empty" with a Plan-my-week link,
 * plus the staples section so a top-up shop can start without a meal plan. Shared
 * by the genuine no-items case AND the loader-degraded (null data) fail-safe.
 */
function EmptyCart({ initialStaples }: { initialStaples: Array<StapleLine> }) {
  return (
    <AppShell>
      <ScreenHeader
        title="Cart"
        subtitle="Your week, turned into one cart with exact amounts."
      />
      <EmptyState
        icon={<ShoppingBag aria-hidden />}
        title="Your cart is empty"
        hint="Plan a week and Souso adds up every ingredient across your dinners, scaled to your household. Or add a few staples below to start a list."
        action={
          <Link to="/week">
            <Button size="pill">Plan my week</Button>
          </Link>
        }
      />
      <div className="px-5 pt-6 pb-4">
        <StaplesSection initialStaples={initialStaples} />
      </div>
    </AppShell>
  )
}
