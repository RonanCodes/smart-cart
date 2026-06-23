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
 * width so prices can land without shifting the layout. Pending is a quiet
 * em-dash; no pulse or scale animations.
 */
export function CartPriceSlot({
  priceCents,
  pending,
  reserve = false,
  checked = true,
  inheritColor = false,
  size = 'row',
}: {
  priceCents?: number
  pending?: boolean
  /** Keep the slot width even when empty (checked rows, store totals). */
  reserve?: boolean
  checked?: boolean
  /** When true, skip foreground classes so the parent sets colour (store switch). */
  inheritColor?: boolean
  size?: 'row' | 'total' | 'bar'
}) {
  if (!reserve && priceCents === undefined && !pending) return null

  const ghost = GHOST[size]
  const showPrice = priceCents !== undefined
  const showPending = pending && !showPrice

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 justify-end tabular-nums',
        size === 'bar' && 'font-extrabold',
        size !== 'bar' && 'font-bold',
      )}
      aria-label={showPending ? 'Pricing' : undefined}
    >
      <span
        aria-hidden
        className={cn(
          'invisible select-none',
          size === 'bar' && 'text-lg',
          size === 'total' && 'text-[0.72rem]',
          size === 'row' && 'text-sm',
        )}
      >
        {ghost}
      </span>
      <span
        className={cn(
          'absolute inset-y-0 right-0 flex items-center justify-end',
          size === 'bar' && 'text-lg',
          size === 'total' && 'text-[0.72rem]',
          size === 'row' && 'text-sm',
          showPrice && 'cart-price-settled',
          !inheritColor &&
            (checked ? 'text-foreground' : 'text-muted-foreground'),
        )}
      >
        {showPrice ? (
          formatCents(priceCents)
        ) : showPending ? (
          <span className="text-muted-foreground/35 font-semibold">—</span>
        ) : null}
      </span>
    </span>
  )
}
