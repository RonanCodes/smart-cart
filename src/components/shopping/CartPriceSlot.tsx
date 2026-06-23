import { formatCents } from '#/lib/pricing'
import { cn } from '#/lib/utils'

/** Invisible sizing string — widest realistic cart total per slot tier. */
const GHOST: Record<'row' | 'total' | 'bar', string> = {
  row: '€99.99',
  total: '€999.99',
  bar: '€999.99',
}

/**
 * Per-row / per-total price slot on the Cart screen. Always reserves the same
 * width so prices can land without shifting the layout. Pending shows animated
 * dots; partial totals can keep the settled amount visible while more lines
 * price in (#cart-incremental-price).
 */
export function CartPriceSlot({
  priceCents,
  pending,
  updating = false,
  reserve = false,
  checked = true,
  inheritColor = false,
  emphasize = false,
  size = 'row',
}: {
  priceCents?: number
  pending?: boolean
  /** True when a partial total/price is visible but more lines are still pricing. */
  updating?: boolean
  /** Keep the slot width even when empty (checked rows, store totals). */
  reserve?: boolean
  checked?: boolean
  /** When true, skip foreground classes so the parent sets colour (store switch). */
  inheritColor?: boolean
  /** Stronger weight for the store-switch total (progress stays secondary). */
  emphasize?: boolean
  size?: 'row' | 'total' | 'bar'
}) {
  if (!reserve && priceCents === undefined && !pending) return null

  const ghost = GHOST[size]
  const showPrice = priceCents !== undefined
  const showPending = pending && !showPrice
  const showUpdating = updating && showPrice

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 justify-end tabular-nums',
        size === 'bar' && 'font-extrabold',
        size === 'total' && (emphasize ? 'font-extrabold' : 'font-bold'),
        size === 'row' && 'font-bold',
      )}
      aria-label={
        showPending ? 'Pricing' : showUpdating ? 'Updating price' : undefined
      }
    >
      <span
        aria-hidden
        className={cn(
          'invisible select-none',
          size === 'bar' && 'text-lg',
          size === 'total' && (emphasize ? 'text-[0.78rem]' : 'text-[0.72rem]'),
          size === 'row' && 'text-sm',
          emphasize && size === 'total' && 'font-extrabold',
        )}
      >
        {ghost}
      </span>
      <span
        className={cn(
          'absolute inset-y-0 right-0 flex items-center justify-end gap-1',
          size === 'bar' && 'text-lg',
          size === 'total' && (emphasize ? 'text-[0.78rem]' : 'text-[0.72rem]'),
          size === 'row' && 'text-sm',
          emphasize && size === 'total' && 'font-extrabold',
          showPrice && 'cart-price-settled',
          showUpdating && 'cart-price-updating',
          !inheritColor &&
            (checked ? 'text-foreground' : 'text-muted-foreground'),
        )}
      >
        {showPrice ? (
          formatCents(priceCents)
        ) : showPending ? (
          <span
            className={cn(
              'cart-price-pending text-xs font-semibold tracking-widest',
              inheritColor
                ? 'text-current opacity-80'
                : 'text-muted-foreground',
            )}
          >
            ···
          </span>
        ) : null}
      </span>
    </span>
  )
}
