import { ChevronRight, Check } from 'lucide-react'
import { Button } from '#/components/ui/button'

interface ReplanReviewProps {
  /** The changed day labels, in calendar order (Monday first). */
  days: Array<string>
  /** Index of the day currently highlighted. */
  index: number
  /** Advance to the next changed day, or finish on the last one. */
  onNext: () => void
  /** Dismiss the stepper (the "Done" / close action). */
  onDone: () => void
}

/**
 * Step-through replan review (#souso-voice). After Souso changes the week by
 * voice, the changed days are highlighted one at a time. This floating bar names
 * the current day and a "Next" button walks to the next change; on the last
 * change "Next" becomes "Done". The parent scrolls + glows the active day, so
 * this bar only drives the cursor.
 *
 * Sits just above the basket CTA so both stay reachable. Mobile-first, no
 * hover-only affordance.
 */
export function ReplanReview({
  days,
  index,
  onNext,
  onDone,
}: ReplanReviewProps) {
  if (days.length === 0) return null
  const current = days[index] ?? days[0]!
  const isLast = index >= days.length - 1
  const position = `${index + 1} of ${days.length}`

  return (
    <div className="fixed bottom-[calc(var(--tab-bar-space)+5.25rem)] left-1/2 z-40 w-[calc(100%-2.5rem)] max-w-md -translate-x-1/2">
      <div className="bg-card border-border flex items-center gap-3 rounded-2xl border p-3 shadow-2xl">
        <div className="min-w-0 flex-1">
          <p className="text-primary text-[0.62rem] font-bold tracking-[0.16em] uppercase">
            Souso changed {days.length === 1 ? '1 day' : `${days.length} days`}
          </p>
          <p className="truncate text-sm font-semibold">
            {current} · {position}
          </p>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="text-muted-foreground px-2 py-1 text-xs font-medium"
        >
          Done
        </button>
        <Button
          type="button"
          size="sm"
          className="gap-1.5"
          onClick={isLast ? onDone : onNext}
          aria-label={isLast ? 'Finish reviewing changes' : 'Next changed day'}
        >
          {isLast ? (
            <>
              <Check className="h-4 w-4" aria-hidden />
              Done
            </>
          ) : (
            <>
              Next
              <ChevronRight className="h-4 w-4" aria-hidden />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
