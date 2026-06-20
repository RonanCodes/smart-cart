import { useState } from 'react'
import {
  UtensilsCrossed,
  Shuffle,
  Sparkles,
  Clock,
  Flame,
  Beef,
  Plus,
} from 'lucide-react'
import type { WeekDayView } from '#/lib/week-server'
import type { SimilarSort } from '#/lib/vectors/similar'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { SimilarSwap } from './SimilarSwap'
import type { SimilarNeighbour } from './SimilarSwap'
import { MealRating } from './MealRating'
import type { MealRating as Rating } from '#/lib/meal-feedback'

interface DayCardProps {
  day: WeekDayView
  /** Whether a swap is in flight for this day (button shows a busy state). */
  busy: boolean
  /** Whether any action anywhere is in flight (disables this card's button). */
  locked: boolean
  /** Tap the card to open the edit sheet (~5 ready alternatives). */
  onEdit: () => void
  /**
   * Add a meal to this (eating-out / empty) day: opens the same picker so the user
   * can drop a dinner in (#175). Only called for a skipped day.
   */
  onAdd: () => void
  /** Swap this day's dinner for the next-best by preference. */
  onSwap: () => void
  /** Load similar recipes for this day's dinner under the given re-rank. */
  onLoadSimilar: (sort: SimilarSort) => Promise<Array<SimilarNeighbour>>
  /** The user picked a similar recipe for this day: write it into the plan. */
  onPickSimilar: (recipeId: string) => Promise<void>
  /** The saved post-meal rating for this day's dinner (null = not rated). */
  rating: Rating
  /** The saved post-meal note for this day's dinner, if any. */
  ratingNote: string | null
  /** Whether a rating write is in flight for this day. */
  ratingBusy: boolean
  /** Submit a post-meal rating + note for this day's dinner (#126). */
  onRate: (next: { rating: Rating; note: string | null }) => Promise<void>
}

/**
 * One day's dinner card. Image (or a fallback glyph), title, cuisine, and the
 * prep / calories / protein chips when the recipe carries them. A skipped day
 * (eating out) renders an empty state instead of a recipe.
 *
 * Two swaps, both full-width tappable buttons (no hover-only affordance, works on
 * touch at 390px):
 *  - Tapping the card itself opens the edit sheet (#123): ~5 ready alternatives,
 *    pre-ranked for the household and shipped with the week, so it opens instantly.
 *    This is THE edit method.
 *  - "Swap" takes the next-best by preference (#12).
 *  - "Similar" expands an inline chooser of the dish's nearest neighbours (#31), so
 *    the replacement stays close to what is already planned ("like this, but a
 *    different night"), with a faster / lighter re-rank toggle.
 */
export function DayCard({
  day,
  busy,
  locked,
  onEdit,
  onAdd,
  onSwap,
  onLoadSimilar,
  onPickSimilar,
  rating,
  ratingNote,
  ratingBusy,
  onRate,
}: DayCardProps) {
  const skipped = !day.recipeRef
  const [showSimilar, setShowSimilar] = useState(false)
  const [picking, setPicking] = useState(false)

  async function pick(recipeId: string) {
    setPicking(true)
    try {
      await onPickSimilar(recipeId)
      setShowSimilar(false)
    } finally {
      setPicking(false)
    }
  }

  return (
    <div className="bg-card border-border flex flex-col overflow-hidden rounded-xl border shadow-sm">
      {/* The whole dish (image + title + macros) is one big tap target that opens
          the edit sheet. A skipped day has nothing to edit, so it is inert. */}
      <button
        type="button"
        disabled={locked || picking}
        onClick={skipped ? onAdd : onEdit}
        aria-label={
          skipped ? `Add a meal to ${day.day}` : `Edit ${day.day}: ${day.meal}`
        }
        className="flex flex-col text-left disabled:cursor-default"
      >
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

        <div className="flex flex-1 flex-col gap-2 px-4 pt-4">
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
        </div>
      </button>

      <div className="flex flex-col gap-2 px-4 pb-4">
        {skipped ? (
          // An eating-out / empty day is not a dead end: a primary action drops a
          // household-ranked dinner in (#175), reusing the same picker the edit
          // flow uses. The card body taps through to the same sheet.
          <Button
            size="sm"
            className="mt-2 w-full"
            disabled={locked || picking}
            onClick={onAdd}
          >
            <Plus className="h-4 w-4" />
            {busy ? 'Adding…' : 'Add a meal'}
          </Button>
        ) : (
          <>
            <p className="text-muted-foreground pt-2 text-center text-xs">
              Tap the dish to see {day.alternatives.length || '5'} ready swaps
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={locked || picking}
                onClick={onSwap}
              >
                <Shuffle className="h-4 w-4" />
                {busy ? 'Swapping…' : 'Swap'}
              </Button>
              <Button
                variant={showSimilar ? 'default' : 'outline'}
                size="sm"
                disabled={locked || picking}
                aria-expanded={showSimilar}
                onClick={() => setShowSimilar((s) => !s)}
              >
                <Sparkles className="h-4 w-4" />
                Similar
              </Button>
            </div>
          </>
        )}

        {showSimilar && !skipped && (
          <SimilarSwap
            onLoad={onLoadSimilar}
            onPick={(recipeId) => void pick(recipeId)}
            picking={picking}
          />
        )}

        {!skipped && (
          <MealRating
            rating={rating}
            note={ratingNote}
            busy={ratingBusy}
            onSubmit={onRate}
          />
        )}
      </div>
    </div>
  )
}
