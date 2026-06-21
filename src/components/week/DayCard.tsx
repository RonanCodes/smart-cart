import { memo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  UtensilsCrossed,
  Utensils,
  RefreshCw,
  Plus,
  ChevronLeft,
} from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { WeekDayView } from '#/lib/week-server'
import type { SimilarSort } from '#/lib/vectors/similar'
import type { SimilarNeighbour } from './SimilarSwap'
import type { MealRating as Rating } from '#/lib/meal-feedback'
import { StickyNote } from '#/components/ui/sticky-note'

interface DayCardProps {
  day: WeekDayView
  busy: boolean
  locked: boolean
  glowing?: boolean
  working?: boolean
  onEdit: () => void
  onAdd: () => void
  onSwap: () => void
  /**
   * DORMANT (Souso restyle, PR #320). The props below drive features the
   * restyled card no longer renders: the inline "Similar" chooser (#31) and the
   * post-meal MealRating (#126), plus the per-day `busy` spinner. They are kept
   * — interface + the wiring in `_authed.week.tsx` — on purpose, so the team can
   * re-enable either feature for the demo by re-adding the markup without
   * rebuilding the plumbing. `busy`, `rating*`, `onRate`, `onLoadSimilar` and
   * `onPickSimilar` are intentionally not destructured in DayCardImpl. Rating
   * still ships standalone at /rate/$planId/$day. See the PR's follow-up comment.
   */
  onLoadSimilar: (sort: SimilarSort) => Promise<Array<SimilarNeighbour>>
  onPickSimilar: (recipeId: string) => Promise<void>
  rating: Rating
  ratingNote: string | null
  ratingBusy: boolean
  onRate: (next: { rating: Rating; note: string | null }) => Promise<void>
  /** Optional comma-list of key ingredients (kept for callers; not rendered). */
  ingredients?: Array<string>
  /** Optional hand-written tag for a special meal, placed by the photo. */
  note?: string
  /**
   * Optional alternatives for this day (design demo + real week, #week-align).
   * When given (>1), the dish becomes a little deck: the NEXT option sits ready
   * behind the current one and swiping the dish left brings it straight forward,
   * no "Replace" step. Without it, a swipe simply fires onSwap (the real
   * server-side replace).
   */
  swapOptions?: Array<WeekDayView>
  /**
   * Optional persist hook for the deck (#week-align). When `swapOptions` is a real
   * pre-ranked deck, the local cycle is only an instant preview; pass this to
   * write the committed pick to the plan (the design route omits it, so its deck
   * stays a pure throwaway preview). Called with the recipe id the swipe landed
   * on, after the visual cycle.
   */
  onSwapTo?: (recipeId: string) => void
}

/** Drag the dish this far left (px) to commit to the next one. */
const SWIPE_TRIGGER = 64
const SWIPE_MAX = 130

/**
 * One day's dinner — Souso / Julienne. A light, card-less row built around a big
 * free-standing die-cut dish sticker on the left and, on the right, the title, a
 * compact meta line (time · kcal · protein) and a quiet action row. The dish is a
 * little swipe-deck: the next option waits ready behind it, and dragging the dish
 * left swaps straight to it. A special meal can carry a hand-written note by its
 * photo. Tapping the dish opens the recipe.
 */
function DayCardImpl({
  day,
  glowing = false,
  working = false,
  locked,
  onEdit,
  onAdd,
  onSwap,
  onSwapTo,
  note,
  swapOptions,
}: DayCardProps) {
  const skipped = !day.recipeRef
  const options = swapOptions && swapOptions.length > 1 ? swapOptions : null

  const [idx, setIdx] = useState(0)
  // Reset the deck index whenever a fresh `swapOptions` array arrives
  // (#week-align): a persisted swap reloads the week, so the chosen dish is back
  // at options[0] and the alternatives are re-derived. Without this the card
  // would keep its incremented index and briefly show the wrong dish. Compares
  // by array identity: the parent memoises the deck, so an unchanged day keeps
  // the same reference and the index is left alone.
  const optionsRef = useRef(swapOptions)
  if (optionsRef.current !== swapOptions) {
    optionsRef.current = swapOptions
    if (idx !== 0) setIdx(0)
  }
  const current = options ? (options[idx % options.length] ?? day) : day
  const next = options ? (options[(idx + 1) % options.length] ?? null) : null

  // Pointer-driven horizontal swipe on the dish. We track it ourselves so a drag
  // never registers as a tap (which opens the recipe) and so vertical scroll is
  // never hijacked.
  const [dragX, setDragX] = useState(0)
  const [settling, setSettling] = useState(false)
  const startX = useRef<number | null>(null)
  const dragged = useRef(false)
  // Mirror dragX in a ref so pointerup reads the latest offset synchronously,
  // independent of React's state-batching / render timing.
  const dragXRef = useRef(0)

  const swipeable = !skipped && !locked

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!swipeable) return
    startX.current = e.clientX
    dragged.current = false
    setSettling(false)
  }
  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (startX.current === null) return
    const dx = e.clientX - startX.current
    if (Math.abs(dx) > 6) {
      dragged.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    // Left-only; a touch of give to the right so it feels physical.
    const clamped = dx < 0 ? Math.max(dx, -SWIPE_MAX) : Math.min(dx * 0.3, 12)
    dragXRef.current = clamped
    setDragX(clamped)
  }
  // Swap to the next dish: cycles the staged options (design demo + real-data
  // preview), or fires the real server-side replace. Used by both the swipe and
  // the switch button. When a real deck is wired with `onSwapTo`, the local cycle
  // is just the instant preview and `onSwapTo` persists the committed pick.
  function commitSwap() {
    if (options) {
      const landed = options[(idx + 1) % options.length]
      setIdx((i) => i + 1)
      if (landed && onSwapTo) onSwapTo(landed.recipeRef)
    } else {
      onSwap()
    }
  }
  function endSwipe() {
    if (startX.current === null) return
    const commit = dragXRef.current <= -SWIPE_TRIGGER
    startX.current = null
    dragXRef.current = 0
    setSettling(true)
    setDragX(0)
    if (commit) commitSwap()
  }

  const openRecipe = () => {
    if (dragged.current) return
    ;(skipped ? onAdd : onEdit)()
  }

  // How far the current dish has been dragged toward committing, 0..1. Drives the
  // cross-fade with the staged-behind next dish.
  const progress = Math.min(1, -dragX / SWIPE_MAX)

  return (
    <div
      className={clsx(
        'border-hairline relative border-b border-dashed py-5 last:border-b-0',
        glowing && 'ai-glow rounded-2xl',
        working && !glowing && 'ai-glow-pulse rounded-2xl',
      )}
    >
      <div className="flex items-center gap-4">
        {/* Left: the dish as a tiny swipe-deck. */}
        <div className="relative h-32 w-32 shrink-0">
          {/* The next option, already waiting behind the current dish. */}
          {next?.imageUrl && (
            <img
              src={next.imageUrl}
              alt=""
              aria-hidden
              draggable={false}
              className="souso-sticker pointer-events-none absolute inset-0 h-32 w-32 object-contain"
              style={{
                transform: `rotate(-2deg) scale(${0.84 + progress * 0.16}) translateX(${8 - progress * 8}px)`,
                opacity: 0.45 + progress * 0.55,
              }}
            />
          )}

          <button
            type="button"
            disabled={locked}
            onClick={openRecipe}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endSwipe}
            onPointerCancel={endSwipe}
            aria-label={
              skipped
                ? `Add a meal to ${day.day}`
                : `Open ${day.day}: ${current.meal}`
            }
            style={{ touchAction: 'pan-y' }}
            className="relative block h-32 w-32"
          >
            {!skipped && current.imageUrl ? (
              <>
                <img
                  src={current.imageUrl}
                  alt={current.meal}
                  draggable={false}
                  className="souso-sticker h-32 w-32 object-contain"
                  style={{
                    transform: `translateX(${dragX}px) rotate(${-4 + dragX / 22}deg)`,
                    opacity: 1 - progress * 0.7,
                    transition: settling
                      ? 'transform 0.25s ease-out, opacity 0.25s ease-out'
                      : 'none',
                  }}
                />
                {swipeable && (
                  <ChevronLeft className="text-muted-foreground/35 absolute top-1/2 -left-1.5 h-4 w-4 -translate-y-1/2" />
                )}
              </>
            ) : (
              <div className="bg-secondary text-muted-foreground/60 flex h-28 w-28 items-center justify-center rounded-2xl">
                <UtensilsCrossed className="h-8 w-8" />
              </div>
            )}
            {note && idx === 0 && (
              <StickyNote
                tilt={6}
                className="absolute -top-2 -right-3 z-10 text-[0.85rem]"
              >
                {note}
              </StickyNote>
            )}
          </button>
        </div>

        {/* Right: title, compact meta, quiet actions. */}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            disabled={locked}
            onClick={openRecipe}
            className="block w-full text-left"
          >
            <span className="text-primary text-[0.64rem] font-bold tracking-[0.16em] uppercase">
              {day.day}
            </span>
            {skipped ? (
              <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[1.05rem] font-bold">
                <Plus className="h-4 w-4" /> Add a dinner
              </p>
            ) : (
              <>
                <h3
                  className="mt-0.5 line-clamp-2 text-[1.1rem] leading-tight font-bold"
                  style={{ letterSpacing: '-0.02em' }}
                >
                  {current.meal}
                </h3>
                <p className="text-muted-foreground mt-1 text-[0.78rem]">
                  {[
                    current.prepMinutes != null && `${current.prepMinutes} min`,
                    current.calories != null && `${current.calories} kcal`,
                    current.protein != null && `${current.protein} g protein`,
                    current.price && current.price,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </p>
              </>
            )}
          </button>

          {!skipped && (
            <div className="mt-2.5 flex items-center gap-2">
              <span className="border-border bg-card text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-semibold shadow-sm">
                <Utensils className="h-3.5 w-3.5" />2
              </span>
              <button
                type="button"
                disabled={locked}
                onClick={commitSwap}
                aria-label="Swap this dinner"
                className="border-border bg-card text-muted-foreground flex h-[1.95rem] w-[1.95rem] items-center justify-center rounded-full border shadow-sm transition active:scale-95"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Memoised so a replan that touches one day re-renders only that day's card. */
export const DayCard = memo(DayCardImpl)
