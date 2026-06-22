import { useEffect, useState } from 'react'
import { StickyNote } from '#/components/ui/sticky-note'
import { useReducedMotion } from './use-reduced-motion'

/**
 * The landing hero's "board of dishes": three die-cut recipe stickers placed by
 * hand on a cork-board feel, with a hand-written note pinned in the corner.
 *
 * Motion (tasteful, CSS/transform-based, no animation library):
 *  - the left sticker slowly drifts UP, the right drifts DOWN, the middle shifts
 *    side-to-side, on a gentle infinite loop (the `hero-drift-*` keyframes);
 *  - every few seconds one slot CYCLES to a fresh dish: the old sticker fades
 *    out and the new one pops in (a short scale-in keyed off React state).
 *
 * Layout: the board is a fixed-height stage with the three stickers absolutely
 * placed in non-overlapping columns, so the drift never pushes a sticker up into
 * the wordmark above and the note never lands on a dish (#465). Mobile-first.
 *
 * prefers-reduced-motion: no drift, no cycling. Each slot shows its first dish,
 * statically, and the note sits still.
 */

/** Per-slot pool of dish-sticker slugs (files in /public/stickers/recipes). */
const SLOTS = [
  {
    key: 'left',
    pool: ['chicken-orzo', 'chicken-skewers', 'orecchiette'],
    h: 'h-24',
    rot: -8,
  },
  {
    key: 'middle',
    pool: ['gnocchi-romesco', 'one-pan-pasta', 'veggie-lasagne'],
    h: 'h-32',
    rot: 4,
  },
  {
    key: 'right',
    pool: ['roast-veg', 'apple-crumble', 'seed-crackers'],
    h: 'h-24',
    rot: 8,
  },
] as const

/** How often a slot swaps to the next dish. Staggered per slot so they don't
 *  all flip on the same beat. */
const CYCLE_MS = 4200

export function HeroStickers() {
  const reduced = useReducedMotion()
  // Index into each slot's pool. Bumped on a per-slot interval to cycle dishes.
  const [indices, setIndices] = useState<Array<number>>(() =>
    SLOTS.map(() => 0),
  )

  useEffect(() => {
    if (reduced) return
    const timers = SLOTS.map((slot, i) =>
      // Stagger each slot's first tick so the three never flip together.
      window.setInterval(
        () => {
          setIndices((prev) => {
            const next = prev.slice()
            next[i] = ((prev[i] ?? 0) + 1) % slot.pool.length
            return next
          })
        },
        CYCLE_MS + i * 1300,
      ),
    )
    return () => timers.forEach((t) => window.clearInterval(t))
  }, [reduced])

  return (
    <div
      className="relative mx-auto mt-7 h-44 w-full max-w-sm"
      data-testid="hero-stickers"
      data-reduced={reduced ? 'true' : 'false'}
    >
      {SLOTS.map((slot, i) => {
        const idx = reduced ? 0 : (indices[i] ?? 0)
        // Pool is a non-empty literal tuple, so this is always defined; the
        // fallback keeps the strict index type happy.
        const img = slot.pool[idx] ?? slot.pool[0]
        return (
          <div
            key={slot.key}
            className={`hero-slot hero-slot-${slot.key} absolute bottom-0`}
            data-slot={slot.key}
          >
            <img
              // Keyed by the chosen dish so React remounts the <img> on a cycle,
              // re-triggering the pop-in animation for the fresh sticker.
              key={img}
              src={`/stickers/recipes/${img}.png`}
              alt=""
              aria-hidden
              className={`hero-sticker souso-sticker ${slot.h} w-auto object-contain`}
              style={{ '--rot': `${slot.rot}deg` } as React.CSSProperties}
            />
          </div>
        )
      })}
      <StickyNote tilt={6} className="absolute -top-2 right-1 z-10">
        no more &ldquo;what&rsquo;s for dinner?&rdquo;
      </StickyNote>
    </div>
  )
}
