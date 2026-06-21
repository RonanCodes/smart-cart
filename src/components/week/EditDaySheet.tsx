import { UtensilsCrossed, Clock, Flame, Beef, Loader2, X } from 'lucide-react'
import type { WeekDayView, DayAlternative } from '#/lib/week-server'
import { Sheet } from '#/components/ui/sheet'
import { RecipeFacts } from '#/components/week/RecipeFacts'

interface EditDaySheetProps {
  /** The day being edited; null closes the sheet. */
  day: WeekDayView | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** True while a pick is being persisted (locks the cards). */
  picking: boolean
  /** The user tapped an alternative: swap it into this day. */
  onPick: (recipeId: string) => void
  /**
   * The user chose "Remove this dinner": clear the day so the household is not
   * cooking that night (#255). Only shown when swapping a planned day (not while
   * adding to an already-empty day). When omitted the action is not rendered.
   */
  onRemove?: () => void
  /**
   * "Add a meal" to an eating-out / empty day (#175) rather than swap a planned
   * one. Changes the copy ("pick a dinner for X" instead of "replace X") and, when
   * `addAlternatives` is provided, renders those (fetched for the empty day) in
   * place of the day's own shipped alternatives, which are empty for an 'out' day.
   */
  adding?: boolean
  /** Alternatives to show when adding to an empty day; null while still loading. */
  addAlternatives?: Array<DayAlternative> | null
}

/**
 * The "edit the week" picker. Tapping a day on the week view opens this bottom
 * sheet (the iOS Sheet primitive, #88) showing ~5 ready alternatives that are
 * already pre-ranked for the household and shipped with the week, so the sheet
 * opens instantly with no spinner. Tapping an alternative swaps it into that day.
 *
 * This is THE edit method: one tap to open, one tap to swap. The alternatives are
 * appetizing cards (image, title, prep, calories, protein), full-width tappable so
 * there is no hover-only affordance and it works on touch at 390px.
 *
 * The same sheet doubles as the "Add a meal" picker for an eating-out / empty day
 * (#175): when `adding` is set the copy reframes to "pick a dinner" and the cards
 * come from `addAlternatives` (fetched on demand, since an 'out' day ships none).
 */
export function EditDaySheet({
  day,
  open,
  onOpenChange,
  picking,
  onPick,
  onRemove,
  adding = false,
  addAlternatives = null,
}: EditDaySheetProps) {
  // When adding to an empty day, the day's own `alternatives` are empty (an 'out'
  // day ships none), so use the on-demand list once it has loaded.
  const alts = adding ? (addAlternatives ?? []) : (day?.alternatives ?? [])
  const loadingAdd = adding && addAlternatives === null

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        day
          ? adding
            ? `Add a meal: ${day.day}`
            : `Swap ${day.day}`
          : undefined
      }
    >
      <div className="pb-2">
        {day && (
          <p className="text-muted-foreground mb-3 text-center text-sm">
            {adding ? (
              <>Pick a dinner for {day.day}.</>
            ) : (
              <>
                Pick a dinner to replace{' '}
                <span className="text-foreground font-medium">{day.meal}</span>.
              </>
            )}
          </p>
        )}

        {loadingAdd ? (
          <p className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-center text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Finding dinners you'll like...
          </p>
        ) : alts.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {adding
              ? 'No dinners left to add this week.'
              : 'No other dinners left to swap in this week.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {alts.map((a) => (
              <li key={a.recipeRef}>
                <button
                  type="button"
                  disabled={picking}
                  onClick={() => onPick(a.recipeRef)}
                  className="border-border bg-card hover:bg-secondary/60 active:bg-secondary flex w-full items-center gap-3 overflow-hidden rounded-xl border p-2 text-left transition-colors disabled:opacity-60"
                >
                  <div className="bg-secondary h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg">
                    {a.imageUrl ? (
                      <img
                        src={a.imageUrl}
                        alt={a.meal}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="text-muted-foreground flex h-full items-center justify-center">
                        <UtensilsCrossed className="h-7 w-7" />
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="line-clamp-2 text-sm leading-snug font-semibold">
                      {a.meal}
                    </span>
                    <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                      {a.cuisine && <span>{a.cuisine}</span>}
                      {a.prepMinutes != null && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {a.prepMinutes} min
                        </span>
                      )}
                      {a.calories != null && (
                        <span className="inline-flex items-center gap-1">
                          <Flame className="h-3 w-3" />
                          {a.calories} kcal
                        </span>
                      )}
                      {a.protein != null && (
                        <span className="inline-flex items-center gap-1">
                          <Beef className="h-3 w-3" />
                          {a.protein}g
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* "Souso knows" — source-cited Cala facts about this day's dish. Only on
            a planned day (an empty 'add' day has no dish to look up). Fetches
            lazily once the sheet is open and hides itself when there's nothing
            (unconfigured key / no facts), so it never shows an empty box. */}
        {!adding && day?.recipeRef && (
          <RecipeFacts
            recipeId={day.recipeRef}
            title={day.meal}
            cuisine={day.cuisine}
            active={open}
          />
        )}

        {/* "Not cooking that night" escape hatch (#255). Only on a planned day:
            an empty day has nothing to remove (it offers "Add a meal" instead).
            Clearing the day flips its card to the empty "No dinner, Add one"
            state and drops it from the shopping list + cart. Full-width tappable
            (no hover-only affordance, works on touch at 390px). */}
        {!adding && onRemove && day && (
          <button
            type="button"
            disabled={picking}
            onClick={onRemove}
            className="text-muted-foreground hover:bg-secondary/60 active:bg-secondary border-border mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm font-medium transition-colors disabled:opacity-60"
          >
            <X className="h-4 w-4" />
            Remove this dinner (eating out)
          </button>
        )}
      </div>
    </Sheet>
  )
}
