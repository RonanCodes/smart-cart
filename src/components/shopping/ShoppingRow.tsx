import type { ShoppingLine } from '#/lib/shopping'

/**
 * One consolidated shopping-list line: the ingredient name, its exact amount
 * (`displayAmount` from the engine, e.g. '450 g' or '2 + 15 g'), and a small
 * meal context line. When the ingredient is used across more than one meal we
 * say so ('in 3 meals') and list the meals beneath; a single-meal item just
 * names its meal. The food-waste callout and cross-store prices are separate
 * slices (#80, #92) and intentionally not rendered here.
 */
export function ShoppingRow({ line }: { line: ShoppingLine }) {
  const mealCount = line.usedInMeals.length
  const context =
    mealCount > 1
      ? `in ${mealCount} meals`
      : (line.usedInMeals[0] ?? 'in your week')

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{line.name}</p>
        <p className="text-muted-foreground mt-0.5 truncate text-sm">
          {context}
          {mealCount > 1 && (
            <span className="text-muted-foreground/80">
              {' '}
              ({line.usedInMeals.join(', ')})
            </span>
          )}
        </p>
      </div>
      <p className="text-foreground shrink-0 pt-0.5 text-sm font-semibold tabular-nums">
        {line.displayAmount}
      </p>
    </div>
  )
}
