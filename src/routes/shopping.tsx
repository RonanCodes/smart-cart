import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { ShoppingBag } from 'lucide-react'
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import { Button } from '#/components/ui/button'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import { hasHousehold } from '#/lib/onboarding-server'
import { loadShoppingList } from '#/lib/shopping-server'
import type { ShoppingListView } from '#/lib/shopping-server'
import { loadStaples, frequentlyBoughtStaples } from '#/lib/staples-server'
import type { StapleLine, FrequentStaple } from '#/lib/staples-server'
import {
  listShoppingItems,
  addWeekToShoppingList,
} from '#/lib/shopping-list-server'
import type { ShoppingItem } from '#/lib/shopping'
import { shouldAutoSeed } from '#/lib/shopping'
import { EditableShoppingList } from '#/components/shopping/EditableShoppingList'
import { CartLinks } from '#/components/shopping/CartLinks'
import { StaplesSection } from '#/components/shopping/StaplesSection'
import { WasteLine } from '#/components/shopping/WasteLine'

interface ShoppingSearch {
  /** Optional plan id, set when arriving from the week view's "Shopping list". */
  plan?: string
  /**
   * Set after the user taps "Clear all": the empty list is a deliberate choice,
   * so the loader must NOT re-seed it from the week on this visit. Survives a
   * reload because it lives in the URL.
   */
  cleared?: boolean
}

export const Route = createFileRoute('/shopping')({
  validateSearch: (search: Record<string, unknown>): ShoppingSearch => ({
    plan: typeof search.plan === 'string' ? search.plan : undefined,
    cleared: search.cleared === true || search.cleared === '1',
  }),
  beforeLoad: async () => {
    const ctx = await requireUserBeforeLoad()
    if (!(await hasHousehold())) throw redirect({ to: '/onboarding' })
    return ctx
  },
  loaderDeps: ({ search }) => ({ plan: search.plan, cleared: search.cleared }),
  loader: async ({
    deps,
  }): Promise<{
    view: ShoppingListView
    staples: Array<StapleLine>
    frequentlyBought: Array<FrequentStaple>
    items: Array<ShoppingItem>
  }> => {
    const [view, staplesRes, frequentRes, itemsRes] = await Promise.all([
      loadShoppingList({ data: deps.plan ? { planId: deps.plan } : {} }),
      loadStaples(),
      frequentlyBoughtStaples(),
      listShoppingItems(),
    ])

    // Auto-seed: if the household has a planned week but no saved rows yet,
    // build the editable list from that week now, so the page IS the clean
    // editable list on first visit instead of a read-only preview that needs a
    // dead "Add to shopping list" tap. Idempotent on the server (planMerge
    // dedupes), and only fired when the list is genuinely empty so a user who
    // cleared their list is not fought by the page re-filling it.
    let items = itemsRes.items
    if (
      shouldAutoSeed({
        planId: view.planId,
        savedItemCount: items.length,
        clearedByUser: deps.cleared,
      })
    ) {
      const seeded = await addWeekToShoppingList({
        data: deps.plan ? { planId: deps.plan } : {},
      })
      items = seeded.items
    }

    return {
      view,
      staples: staplesRes.staples,
      frequentlyBought: frequentRes.items,
      items,
    }
  },
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
  const { view, staples, frequentlyBought, items } = Route.useLoaderData()
  const { plan } = Route.useSearch()
  const navigate = useNavigate()
  const hasSavedItems = items.length > 0

  // Record a deliberate clear in the URL so a reload does not re-seed the list
  // from the week. `replace` keeps it out of the back-stack.
  function markCleared() {
    void navigate({
      to: '/shopping',
      search: { plan, cleared: true },
      replace: true,
    })
  }

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
        <WasteLine waste={view.waste} />
      </div>

      {/* The editable, persisted list: the primary UI. Tick, rename, re-amount,
          add, and remove all survive a reload. */}
      {hasSavedItems && (
        <div className="px-5 pt-3 pb-2">
          <EditableShoppingList initialItems={items} onCleared={markCleared} />
        </div>
      )}

      {/* One-click "Add all to Albert Heijn / Jumbo" deep-links (#147), kept
          prominent right under the list. */}
      {hasSavedItems && (
        <div className="px-5 pt-2 pb-2">
          <CartLinks />
        </div>
      )}

      {/* Staples search, secondary, below the list. */}
      <div className="px-5 pt-2 pb-4">
        <StaplesSection
          initialStaples={staples}
          frequentlyBought={frequentlyBought}
        />
      </div>
    </AppShell>
  )
}
