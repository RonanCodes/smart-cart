import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'

/**
 * The optional tip prompt shown on add-to-cart (decisions #16-#19).
 *
 * Reward, never guilt (#18): the mascot reaction is positive-only, neutral and
 * kind at no-tip (never sad), happier as the tip climbs. "No tip" (slider at 0)
 * is a real, unpunished choice. We call it an optional fee, not a "tip", when a
 * default is on, so it stays honest.
 *
 * The mascot uses emoji (the PNG mascot set isn't committed yet); swap to the
 * `souso-*` art when it lands.
 */
const STEPS: { emoji: string; label: string }[] = [
  { emoji: '🧺', label: 'No tip, all good!' },
  { emoji: '🙂', label: 'Thanks!' },
  { emoji: '😊', label: 'Lovely, cheers!' },
  { emoji: '😄', label: "You're the best!" },
  { emoji: '🤩', label: 'Amazing!' },
  { emoji: '🥳', label: 'Over the moon!' },
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
  freeRemaining,
  busy,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Estimated basket total in euro, for the percent math. */
  basketTotal: number
  /** Free adds left this month (0 once a tip is expected). */
  freeRemaining: number
  busy: boolean
  /** User confirmed: the chosen whole percent (0 = no tip). */
  onConfirm: (percent: number) => void
}) {
  const free = freeRemaining > 0
  const [percent, setPercent] = useState(free ? 0 : 3)
  const step = STEPS[percent] ?? { emoji: '🧺', label: 'No tip, all good!' }
  const amount = tipAmount(percent, basketTotal)

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Send to your store">
      <div className="space-y-5 pb-2">
        <div className="flex flex-col items-center gap-1 py-2">
          <div className="text-5xl transition-transform" aria-hidden>
            {step.emoji}
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
          {free
            ? `This one's on us, ${freeRemaining} free left this month. A tip is optional and just supports Souso.`
            : 'An optional tip keeps Souso running. Totally up to you, no pressure.'}
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
