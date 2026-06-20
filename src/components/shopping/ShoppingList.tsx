import { Sparkles } from 'lucide-react'
import type { ShoppingListView } from '#/lib/shopping-server'
import { Badge } from '#/components/ui/badge'
import { ShoppingRow } from './ShoppingRow'
import { WasteSummary } from './WasteSummary'

/**
 * The consolidated shopping-list view rendered on the Shopping tab. Two blocks:
 *
 *   1. A "shared across meals" block surfaced prominently at the top: the
 *      interlinked ingredients you buy once but use in several dinners (the
 *      food-waste pitch leg of #77). Only shown when there is at least one.
 *   2. The full list, one row per consolidated ingredient with its exact amount.
 *
 * A small header line states how many items the week needs and the portions the
 * amounts were scaled to. The food-waste savings callout (#80) and cross-store
 * prices (#92) plug in here later; this component leaves the seams and does not
 * build them.
 */
export function ShoppingList({ view }: { view: ShoppingListView }) {
  const { list, shared, portions, waste } = view
  const itemCount = list.estimatedItems
  const peopleLabel = describePortions(portions.adults, portions.children ?? 0)

  return (
    <div className="space-y-6 px-5 pt-2">
      <p className="text-muted-foreground text-sm">
        {itemCount} {itemCount === 1 ? 'item' : 'items'} to buy, scaled for{' '}
        {peopleLabel}.
      </p>

      <WasteSummary waste={waste} />

      {shared.length > 0 && (
        <section aria-labelledby="shared-heading" className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary h-4 w-4" aria-hidden />
            <h2
              id="shared-heading"
              className="text-sm font-semibold tracking-tight"
            >
              Used across meals
            </h2>
            <Badge variant="primary">{shared.length}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            Buy these once, use them in several dinners. Less waste, less spend.
          </p>
          <div className="bg-card border-border divide-border divide-y overflow-hidden rounded-[var(--radius-ios)] border">
            {shared.map((line) => (
              <ShoppingRow
                key={`shared-${line.name}`}
                line={line}
                highlightReuse
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="all-heading" className="space-y-2">
        <h2 id="all-heading" className="text-sm font-semibold tracking-tight">
          Everything you need
        </h2>
        <div className="bg-card border-border divide-border divide-y overflow-hidden rounded-[var(--radius-ios)] border">
          {list.lines.map((line) => (
            <ShoppingRow key={line.name} line={line} />
          ))}
        </div>
      </section>
    </div>
  )
}

/** 'a household of 2', '2 adults + 1 child', etc. — the portion context line. */
function describePortions(adults: number, children: number): string {
  const parts: Array<string> = []
  if (adults > 0) parts.push(`${adults} ${adults === 1 ? 'adult' : 'adults'}`)
  if (children > 0)
    parts.push(`${children} ${children === 1 ? 'child' : 'children'}`)
  if (parts.length === 0) return 'your household'
  return parts.join(' + ')
}
