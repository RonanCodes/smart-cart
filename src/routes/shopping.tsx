import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ShoppingBag } from 'lucide-react'
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import { Button } from '#/components/ui/button'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import { hasHousehold } from '#/lib/onboarding-server'
import { loadShoppingList } from '#/lib/shopping-server'
import type { ShoppingListView } from '#/lib/shopping-server'
import { loadStaples, frequentlyBoughtStaples } from '#/lib/staples-server'
import type { StapleLine, FrequentStaple } from '#/lib/staples-server'
import { ShoppingList } from '#/components/shopping/ShoppingList'
import { StaplesSection } from '#/components/shopping/StaplesSection'

interface ShoppingSearch {
  /** Optional plan id, set when arriving from the week view's "Shopping list". */
  plan?: string
}

export const Route = createFileRoute('/shopping')({
  validateSearch: (search: Record<string, unknown>): ShoppingSearch => ({
    plan: typeof search.plan === 'string' ? search.plan : undefined,
  }),
  beforeLoad: async () => {
    const ctx = await requireUserBeforeLoad()
    if (!(await hasHousehold())) throw redirect({ to: '/onboarding' })
    return ctx
  },
  loaderDeps: ({ search }) => ({ plan: search.plan }),
  loader: async ({
    deps,
  }): Promise<{
    view: ShoppingListView
    staples: Array<StapleLine>
    frequentlyBought: Array<FrequentStaple>
  }> => {
    const [view, staplesRes, frequentRes] = await Promise.all([
      loadShoppingList({ data: deps.plan ? { planId: deps.plan } : {} }),
      loadStaples(),
      frequentlyBoughtStaples(),
    ])
    return {
      view,
      staples: staplesRes.staples,
      frequentlyBought: frequentRes.items,
    }
  },
  component: Shopping,
})

/**
 * Shopping tab — the week's recipes turned into ONE consolidated shopping list
 * with exact amounts and the meals each ingredient serves (slice #79, PRD #77).
 * The filled AH / Jumbo basket (Nicolas's #14) plugs in beneath this later.
 */
function Shopping() {
  const { view, staples, frequentlyBought } = Route.useLoaderData()
  const noRecipeList = !view.planId || view.list.lines.length === 0

  // No week planned and no staples yet: the bare empty state, but still let the
  // user start a list from staples alone (a top-up shop without a meal plan).
  if (noRecipeList && staples.length === 0) {
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
      {!noRecipeList && <ShoppingList view={view} />}
      <div className="px-5 pt-2 pb-4">
        <StaplesSection
          initialStaples={staples}
          frequentlyBought={frequentlyBought}
        />
      </div>
    </AppShell>
  )
}
