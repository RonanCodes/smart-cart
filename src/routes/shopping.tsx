import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ShoppingBag } from 'lucide-react'
import { AppShell, ScreenHeader, EmptyState } from '#/components/ui/app-shell'
import { Button } from '#/components/ui/button'
import { requireUserBeforeLoad } from '#/lib/route-guards'
import { hasHousehold } from '#/lib/onboarding-server'
import { loadShoppingList } from '#/lib/shopping-server'
import type { ShoppingListView } from '#/lib/shopping-server'
import { ShoppingList } from '#/components/shopping/ShoppingList'

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
  loader: async ({ deps }): Promise<{ view: ShoppingListView }> => ({
    view: await loadShoppingList({
      data: deps.plan ? { planId: deps.plan } : {},
    }),
  }),
  component: Shopping,
})

/**
 * Shopping tab — the week's recipes turned into ONE consolidated shopping list
 * with exact amounts and the meals each ingredient serves (slice #79, PRD #77).
 * The filled AH / Jumbo basket (Nicolas's #14) plugs in beneath this later.
 */
function Shopping() {
  const { view } = Route.useLoaderData()

  if (!view.planId || view.list.lines.length === 0) {
    return (
      <AppShell>
        <ScreenHeader
          title="Shopping"
          subtitle="Your week, turned into one shopping list with exact amounts."
        />
        <EmptyState
          icon={<ShoppingBag aria-hidden />}
          title="No shopping list yet"
          hint="Plan a week and Souso adds up every ingredient across your dinners, scaled to your household."
          action={
            <Link to="/week">
              <Button size="pill">Plan my week</Button>
            </Link>
          }
        />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <ScreenHeader
        title="Shopping"
        subtitle="One list for the week, with the exact amount you need."
      />
      <ShoppingList view={view} />
    </AppShell>
  )
}
