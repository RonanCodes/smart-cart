import { useEffect, useState } from 'react'
import { Shuffle, X } from 'lucide-react'
import type { WeekDayView } from '#/lib/week-server'
import { getRecipeVideo } from '#/lib/recipe-media-server'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'
import { StickyNote } from '#/components/ui/sticky-note'
import { RecipeFacts } from '#/components/week/RecipeFacts'
import { RecipeDetail } from '#/components/week/RecipeDetail'
import { PlayableRecipeImage } from '#/components/recipe/PlayableRecipeImage'

interface RecipeSheetProps {
  /** The day whose dish to read; null closes the sheet. */
  day: WeekDayView | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** True while a remove is being persisted (locks the actions). */
  busy: boolean
  /**
   * "Swap this dinner": open the swap chooser pull-up (#291) for this day, a
   * convenience so the user can get to the alternatives without first closing the
   * recipe sheet.
   */
  onSwap: () => void
  /**
   * The user chose "Remove this dinner": clear the day so the household is not
   * cooking that night (#255). When omitted the action is not rendered.
   */
  onRemove?: () => void
}

/**
 * The recipe sheet (#291): tapping a planned dish on the week opens this bottom
 * pull-up, titled with the RECIPE NAME (not "Swap <Day>"), so it reads as a
 * recipe card rather than a swap picker. Contents are the dish itself, with
 * swapping pushed to its own action:
 *  - RecipeDetail: ingredients + written-out cooking steps + time / servings.
 *  - RecipeFacts ("Souso knows"): source-cited Cala facts, hidden when empty.
 *  - "Swap this dinner": opens the SwapSheet alternatives chooser (the swap list
 *    used to live in this same sheet, now lifted out so each does one thing).
 *  - "Remove this dinner (eating out)": the #255 escape hatch.
 *
 * Both inner cards fetch lazily once `open` (the RecipeDetail / RecipeFacts
 * `active` gate), so the week itself never carries the per-dish detail. Renders
 * only for a planned day; an empty 'out' day opens the SwapSheet in add-mode.
 */
export function RecipeSheet({
  day,
  open,
  onOpenChange,
  busy,
  onSwap,
  onRemove,
}: RecipeSheetProps) {
  // The cooking video for this dish, fetched lazily once the sheet is open. Read
  // only (videoUrl + status); null until the inspector has generated a clip, so
  // the hero degrades to a plain photo with no play badge. Reset per recipe so a
  // previous dish's video never bleeds into the next.
  const recipeRef = day?.recipeRef ?? ''
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !recipeRef) return
    let cancelled = false
    setVideoUrl(null)
    void getRecipeVideo({ data: { recipeId: recipeRef } })
      .then((res) => {
        if (!cancelled) setVideoUrl(res.videoUrl)
      })
      .catch(() => {
        // Degrade to image-only: leave videoUrl null so we show just the photo.
        if (!cancelled) setVideoUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, recipeRef])

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={day?.meal}>
      <div className="pb-16">
        {/* Hero: the die-cut dish sticker (the recipeImageUrl-resolved sticker
            from the week row) with a hand-written keeper note tucked at the
            corner, the Souso "personal recipe-book" touch. The same photo
            becomes the cooking video on tap (seamless: the video's poster is
            this photo). No video cached -> just the still, no play badge. */}
        {day?.recipeRef && day.imageUrl && (
          <div className="relative -mt-1 flex justify-center pb-1">
            <PlayableRecipeImage
              imageSrc={day.imageUrl}
              videoUrl={videoUrl}
              alt={day.meal}
              className="h-48 w-48 -rotate-3"
            />
            <StickyNote
              tilt={6}
              className="absolute top-2 right-1 text-[0.9rem]"
            >
              a household favourite ✶
            </StickyNote>
          </div>
        )}

        {/* The dish itself: facts strip, ingredient stickers + amounts, and the
            numbered steps. Lazy-loads once the sheet is open. */}
        {day?.recipeRef && (
          <RecipeDetail
            recipeId={day.recipeRef}
            active={open}
            calories={day.calories}
            protein={day.protein}
          />
        )}

        {/* "Souso knows" — source-cited Cala facts about this day's dish. Fetches
            lazily once the sheet is open and hides itself when there's nothing
            (unconfigured key / no facts), so it never shows an empty box. */}
        {day?.recipeRef && (
          <RecipeFacts
            recipeId={day.recipeRef}
            title={day.meal}
            cuisine={day.cuisine}
            active={open}
          />
        )}

        {/* "Swap this dinner": opens the alternatives chooser pull-up (#291).
            Full-width tappable (no hover-only affordance, works on touch at
            390px). */}
        {day && (
          <Button
            variant="outline"
            className="mt-4 w-full"
            disabled={busy}
            onClick={onSwap}
          >
            <Shuffle className="h-4 w-4" />
            Swap this dinner
          </Button>
        )}

        {/* "Not cooking that night" escape hatch (#255). Clearing the day flips
            its card to the empty "No dinner, Add one" state and drops it from the
            shopping list + cart. Full-width tappable. */}
        {onRemove && day && (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="text-muted-foreground hover:bg-secondary/60 active:bg-secondary border-border mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm font-medium transition-colors disabled:opacity-60"
          >
            <X className="h-4 w-4" />
            Remove this dinner (eating out)
          </button>
        )}
      </div>
    </Sheet>
  )
}
