import { useState } from 'react'
import { Loader2, Heart, ShoppingBasket } from 'lucide-react'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'

/**
 * The optional tip prompt shown on add-to-cart (decisions #16-#19).
 *
 * Reward, never guilt (#18): the reaction is positive-only, neutral and kind at
 * no-tip (a calm basket, never sad), and a warmer filled heart that grows as the
 * tip climbs. "No tip" (slider at 0) is a real, unpunished choice. We call it an
 * optional fee, not a "tip", when a default is on, so it stays honest.
 */
const STEPS: { label: string }[] = [
  { label: 'No tip, all good!' },
  { label: 'Thanks!' },
  { label: 'Lovely, cheers!' },
  { label: "You're the best!" },
  { label: 'Amazing!' },
  { label: 'Over the moon!' },
]

const FEE_FLOOR = 0.5

function tipAmount(percent: number, basketTotal: number): number {
  if (percent <= 0) return 0
  return Math.max((percent / 100) * basketTotal, FEE_FLOOR)
}

export function TipSheet({
  open,
  onOpenChange,
  basketTotal,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Estimated basket total in euro, for the percent math. */
  basketTotal: number
  busy: boolean
  /** User confirmed: the chosen whole percent (0 = no tip). */
  onConfirm: (percent: number) => void
}) {
  // Always prompt with a default tip (the free-3-a-month tier is skipped so the
  // tip is always visible for the demo). "No tip" stays one slide away (#18).
  const [percent, setPercent] = useState(3)
  const step = STEPS[percent] ?? { label: 'No tip, all good!' }
  const amount = tipAmount(percent, basketTotal)
  // Neutral basket at no-tip; a filled heart that grows with the tip otherwise.
  const tipping = percent > 0
  const heartSize = `${1.6 + percent * 0.12}rem`

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Send to your store">
      <div className="space-y-5 pb-2">
        <div className="flex flex-col items-center gap-2 py-2">
          <div
            className="bg-secondary text-primary flex h-16 w-16 items-center justify-center rounded-full"
            aria-hidden
          >
            {tipping ? (
              <Heart
                fill="currentColor"
                style={{ width: heartSize, height: heartSize }}
              />
            ) : (
              <ShoppingBasket className="h-7 w-7" />
            )}
          </div>
          <p className="text-sm font-medium">{step.label}</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              {percent === 0 ? 'No tip' : `${percent}% tip`}
            </span>
            <span className="text-muted-foreground">
              {percent === 0 ? '' : `€${amount.toFixed(2)}`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={5}
            step={1}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            aria-label="Tip percentage"
            className="accent-primary w-full"
            disabled={busy}
          />
          <div className="text-muted-foreground flex justify-between text-[10px]">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <span key={n}>{n === 0 ? 'none' : `${n}%`}</span>
            ))}
          </div>
        </div>

        <p className="text-muted-foreground text-center text-xs">
          An optional tip keeps Souso running. Totally up to you, no pressure.
        </p>

        <Button
          size="pill"
          className="w-full"
          disabled={busy}
          onClick={() => onConfirm(percent)}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : percent === 0 ? (
            'Open my cart, no tip'
          ) : (
            `Tip €${amount.toFixed(2)} & open my cart`
          )}
        </Button>
      </div>
    </Sheet>
  )
}
