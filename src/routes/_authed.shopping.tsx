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
import type { StoreSlug } from '#/lib/store-pref-server'

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
    // staples + frequently-bought + saved items + store, plus the auto-seed
    // branch, server-side. The auto-seed fires once per plan; a deliberate
    // "Clear all" stays cleared via the household's durable lastSeededPlanId
    // (#311), so no `cleared` URL flag is needed.
    loadShoppingBootstrap({
      data: { planId: deps.plan },
    }),
  // Skeleton while the loader resolves (#226). The loader can auto-seed the list
  // from the week, so this is the slice's most visible loading win. SSR is
  // untouched: the loader runs server-side and hydrates first paint; the
  // skeleton only shows on client navigations and slow loads.
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
  const {
    view,
    staples: initialStaples,
    frequentlyBought,
    items: initialItems,
    preferredStore,
  } = Route.useLoaderData()
  const hasSavedItems = initialItems.length > 0

  // The route OWNS the live list + extras + their checked state (#311), plus the
  // selected store (#cart-align), so the store switch, the per-item prices, the
  // floating total and the order button all recompute together from the UNCHECKED
  // set with no full reload.
  const [liveItems, setLiveItems] = useState<Array<ShoppingItem>>(initialItems)
  const [liveStaples, setLiveStaples] =
    useState<Array<StapleLine>>(initialStaples)
  const [checkedExtraIds, setCheckedExtraIds] = useState<Set<string>>(new Set())
  const [store, setStore] = useState<StoreSlug>(preferredStore)

  // The extras as cart-set shape: a staple's saved slug already carries its
  // store, so a tick excludes it from that store's basket + cart.
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

  // The single live UNCHECKED set the comparison + cart consume.
  const liveSet = useMemo(
    () => deriveLiveCartSet(liveItems, extras, checkedExtraIds),
    [liveItems, extras, checkedExtraIds],
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

  // Nothing to shop for yet: no saved rows and no staples. The bare empty
  // state, but still let the user start a list from staples alone (a top-up
  // shop without a meal plan).
  if (!hasSavedItems && initialStaples.length === 0) {
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
          <StaplesSection
            initialStaples={initialStaples}
            frequentlyBought={frequentlyBought}
          />
        </div>
      </AppShell>
    )
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
              onSelect={setStore}
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
          per-item price per row. Tick, rename, re-amount, add, remove all survive
          a reload; state mirrors up so the totals + cart recompute on a tick. */}
      {hasSavedItems && (
        <div className="px-5 pt-3 pb-2">
          <EditableShoppingList
            initialItems={initialItems}
            onItemsChange={setLiveItems}
            priceMap={priceMap}
          />
        </div>
      )}

      {/* "Also on my list" extras / staples. A ticked extra leaves the basket +
          cart (#311). */}
      <div className="px-5 pt-2 pb-2">
        <StaplesSection
          initialStaples={initialStaples}
          frequentlyBought={frequentlyBought}
          onStaplesChange={setLiveStaples}
          onCheckedChange={setCheckedExtraIds}
        />
      </div>

      {/* Clear the floating order bar at the bottom of the scroll. */}
      <div aria-hidden className="h-32" />

      {/* Floating total + "Order at <store>" CTA, pinned above the tab bar. Reads
          the SELECTED store's real total, sends the UNCHECKED set to its cart. */}
      {hasSavedItems && (
        <FloatingOrderBar
          store={store}
          data={priceData}
          itemNames={liveSet.itemNames}
          extras={extras.filter((e) => !checkedExtraIds.has(e.id))}
        />
      )}
    </AppShell>
  )
}
