import { UtensilsCrossed, Shuffle, Clock, Flame, Beef } from 'lucide-react'
import type { WeekDayView } from '#/lib/week-server'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'

interface DayCardProps {
  day: WeekDayView
  /** Whether a swap is in flight for this day (button shows a busy state). */
  busy: boolean
  /** Whether any action anywhere is in flight (disables this card's button). */
  locked: boolean
  /** Swap this day's dinner for the next-best by preference. */
  onSwap: () => void
}

/**
 * One day's dinner card. Image (or a fallback glyph), title, cuisine, and the
 * prep / calories / protein chips when the recipe carries them. A skipped day
 * (eating out) renders an empty state instead of a recipe. Swap is a full-width
 * tappable button: no hover-only affordance, so it works on touch at 390px.
 */
export function DayCard({ day, busy, locked, onSwap }: DayCardProps) {
  const skipped = !day.recipeRef

  return (
    <div className="bg-card border-border flex flex-col overflow-hidden rounded-xl border shadow-sm">
      <div className="bg-secondary aspect-[4/3] w-full">
        {!skipped && day.imageUrl ? (
          <img
            src={day.imageUrl}
            alt={day.meal}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            <UtensilsCrossed className="h-9 w-9" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {day.day}
          </span>
          {!skipped && day.cuisine && <Badge>{day.cuisine}</Badge>}
        </div>

        {skipped ? (
          <p className="text-muted-foreground flex-1 text-sm">
            Eating out, no dinner planned.
          </p>
        ) : (
          <>
            <h3 className="flex-1 text-base leading-snug font-semibold">
              {day.meal}
            </h3>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {day.prepMinutes != null && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {day.prepMinutes} min
                </span>
              )}
              {day.calories != null && (
                <span className="inline-flex items-center gap-1">
                  <Flame className="h-3.5 w-3.5" />
                  {day.calories} kcal
                </span>
              )}
              {day.protein != null && (
                <span className="inline-flex items-center gap-1">
                  <Beef className="h-3.5 w-3.5" />
                  {day.protein}g protein
                </span>
              )}
            </div>
          </>
        )}

        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          disabled={locked || skipped}
          onClick={onSwap}
        >
          <Shuffle className="h-4 w-4" />
          {busy ? 'Swapping…' : 'Swap'}
        </Button>
      </div>
    </div>
  )
}
