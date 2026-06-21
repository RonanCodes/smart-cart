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
  const { view, staples, frequentlyBought, items, preferredStore } =
    Route.useLoaderData()
  const hasSavedItems = items.length > 0

  // Nothing to shop for yet: no saved rows and no staples. The bare empty
  // state, but still let the user start a list from staples alone (a top-up
  // shop without a meal plan).
  if (!hasSavedItems && staples.length === 0) {
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
            initialStaples={staples}
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

      {/* The editable, persisted list: the primary UI. Tick, rename, re-amount,
          add, and remove all survive a reload. */}
      {hasSavedItems && (
        <div className="px-5 pt-3 pb-2">
          <EditableShoppingList initialItems={items} />
        </div>
      )}

      {/* Per-store price + wastage comparison (#293), below the store-agnostic
          list. The list above stays store-agnostic; this answers "where is this
          cheapest, and how much do I waste there?". The single "Send to <store>"
          action below stays the one cart action (#243). */}
      {hasSavedItems && (
        <div className="px-5 pt-2 pb-2">
          <PriceComparison
            lines={items.map((it) => ({ name: it.name, amount: it.amount }))}
          />
        </div>
      )}

      {/* Staples / extras search, below the list. These are part of the cart
          action too, so they sit ABOVE the bottom button (#238). */}
      <div className="px-5 pt-2 pb-2">
        <StaplesSection
          initialStaples={staples}
          frequentlyBought={frequentlyBought}
        />
      </div>

      {/* The store selector + single "Send to <store>" action, at the VERY
          bottom so it reads as "everything above goes in the cart" (#238).
          Covers the week list AND the extras. */}
      {hasSavedItems && (
        <div className="border-border/60 mt-2 border-t px-5 pt-4 pb-6">
          <CartLinks preferredStore={preferredStore} />
        </div>
      )}
    </AppShell>
  )
}
