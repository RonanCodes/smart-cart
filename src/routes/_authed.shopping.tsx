import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ShoppingBag } from 'lucide-react'
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import { Button } from '#/components/ui/button'
import { loadShoppingBootstrap } from '#/lib/shopping-server'
import type { ShoppingBootstrap } from '#/lib/shopping-server'
import { EditableShoppingList } from '#/components/shopping/EditableShoppingList'
import { CartLinks } from '#/components/shopping/CartLinks'
import { StaplesSection } from '#/components/shopping/StaplesSection'
import { WasteLine } from '#/components/shopping/WasteLine'
import { PriceComparison } from '#/components/shopping/PriceComparison'
import { ShoppingSkeleton } from '#/components/shopping/ShoppingSkeleton'
import type { ShoppingItem } from '#/lib/shopping'
import type { StapleLine } from '#/lib/staples-server'
import { deriveLiveCartSet } from '#/lib/shopping/cart-set'
import type { CartExtra } from '#/lib/shopping/cart-set'

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
 * Shopping tab — the week's recipes turned into ONE consolidated, editable list
 * with exact amounts (slice #79, PRD #77; redesign #178).
 *
 * The editable, persisted list is the DEFAULT view. The loader auto-seeds it
 * from the week when the household has a plan but no saved rows yet, so the
 * first visit lands straight on the real list, not a read-only preview. The
 * food-waste pitch is collapsed into one quiet line above the list rather than
 * the old stack of cards; the staples search sits secondary below it; the
 * "Add all to Albert Heijn / Jumbo" deep-links stay prominent at the top.
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

  // The route OWNS the live list + extras + their checked state (#311), so the
  // price comparison and the single cart action recompute from the UNCHECKED set
  // as the user ticks rows off, with no full reload. EditableShoppingList and
  // StaplesSection still own their server round-trips; they mirror their state up
  // here through the on*Change callbacks.
  const [liveItems, setLiveItems] = useState<Array<ShoppingItem>>(initialItems)
  const [liveStaples, setLiveStaples] =
    useState<Array<StapleLine>>(initialStaples)
  const [checkedExtraIds, setCheckedExtraIds] = useState<Set<string>>(new Set())

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

  // The single live UNCHECKED set both siblings consume.
  const liveSet = useMemo(
    () => deriveLiveCartSet(liveItems, extras, checkedExtraIds),
    [liveItems, extras, checkedExtraIds],
  )

  // Nothing to shop for yet: no saved rows and no staples. The bare empty
  // state, but still let the user start a list from staples alone (a top-up
  // shop without a meal plan).
  if (!hasSavedItems && initialStaples.length === 0) {
    return (
      <AppShell>
        <ScreenHeader
          title="Shopping"
          subtitle="Your week, turned into one shopping list with exact amounts."
        />
        <EmptyState
          icon={<ShoppingBag aria-hidden />}
          title="No shopping list yet"
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
      <ScreenHeader
        title="Shopping"
        subtitle="One list for the week, with the exact amount you need."
      />

      {/* One quiet line for the food-waste story, in place of the old card
          stack. Hidden when there is nothing honest to claim. */}
      <div className="px-5 pt-1">
        <WasteLine waste={view.waste} estimated={view.amountsEstimated} />
      </div>

      {/* STORE-AGNOSTIC, TOP: the week's recipe ingredients WITH amounts, the
          primary editable list. Tick, rename, re-amount, add, remove all survive
          a reload. State mirrors up so the comparison + cart recompute on a tick
          (#311). */}
      {hasSavedItems && (
        <div className="px-5 pt-3 pb-2">
          <EditableShoppingList
            initialItems={initialItems}
            onItemsChange={setLiveItems}
          />
        </div>
      )}

      {/* STORE-AGNOSTIC, BELOW THAT: "Also on my list" extras / staples. No
          AH / Jumbo branding drives the order here; the store comparison is the
          next block down. State mirrors up so a ticked extra leaves the basket +
          cart (#311). */}
      <div className="px-5 pt-2 pb-2">
        <StaplesSection
          initialStaples={initialStaples}
          frequentlyBought={frequentlyBought}
          onStaplesChange={setLiveStaples}
          onCheckedChange={setCheckedExtraIds}
        />
      </div>

      {/* PER-STORE COMPARISON, BELOW THE STORE-AGNOSTIC SECTIONS (#293, #311).
          Each store's basket = the UNCHECKED recipe ingredients PLUS the
          unchecked extras, priced with waste + unavailable over the COMBINED set.
          Ticking an item off (recipe line or extra) recomputes it live. */}
      {hasSavedItems && (
        <div className="px-5 pt-2 pb-2">
          <PriceComparison lines={liveSet.compareLines} />
        </div>
      )}

      {/* The store selector + single "Send to <store>" action, at the VERY
          bottom so it reads as "everything above goes in the cart" (#238).
          Sends the UNCHECKED recipe items AND the unchecked extras to the chosen
          store, reacting to ticks with no DB lag (#311). */}
      {hasSavedItems && (
        <div className="border-border/60 mt-2 border-t px-5 pt-4 pb-6">
          <CartLinks
            preferredStore={preferredStore}
            itemNames={liveSet.itemNames}
            extras={extras.filter((e) => !checkedExtraIds.has(e.id))}
          />
        </div>
      )}
    </AppShell>
  )
}
