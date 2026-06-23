import { useState } from 'react'
import { StickyNote } from '#/components/ui/sticky-note'

/**
 * The landing hero's "board of dishes": three die-cut recipe stickers placed by
 * hand on a cork-board feel, with a hand-written note pinned in the corner.
 *
 * Static by default. The board renders a FIXED, curated set: the same three
 * dishes on every page load (index 0 of each slot's pool), with no drift, no
 * sway, and no auto-cycling. The stickers don't move on their own.
 *
 * Each slot is a button: tapping it advances that slot to the next dish in its
 * pool (a short, optional pop transition, no looping). The other slots stay put.
 *
 * Layout: a fixed-height stage with the three stickers absolutely placed in
 * non-overlapping columns, so a sticker never pushes up into the wordmark above
 * and the note never lands on a dish (#465). Mobile-first.
 */

/** Per-slot pool of dish-sticker slugs (files in /public/stickers/recipes).
 *  The first entry is the curated default shown on every load. */
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

export function HeroStickers() {
  // Index into each slot's pool. Starts at the curated default (0,0,0) so the
  // board is identical on every mount; only a tap bumps a slot's index.
  const [indices, setIndices] = useState<Array<number>>(() =>
    SLOTS.map(() => 0),
  )

  function advance(i: number) {
    setIndices((prev) => {
      const next = prev.slice()
      const pool = SLOTS[i]?.pool
      if (!pool) return prev
      next[i] = ((prev[i] ?? 0) + 1) % pool.length
      return next
    })
  }

  return (
    <div
      className="relative mx-auto mt-7 h-44 w-full max-w-sm"
      data-testid="hero-stickers"
    >
      {SLOTS.map((slot, i) => {
        const idx = indices[i] ?? 0
        // Pool is a non-empty literal tuple, so this is always defined; the
        // fallback keeps the strict index type happy.
        const img = slot.pool[idx] ?? slot.pool[0]
        return (
          <button
            key={slot.key}
            type="button"
            onClick={() => advance(i)}
            aria-label="Show another dish"
            className={`hero-slot hero-slot-${slot.key} absolute bottom-0 cursor-pointer bg-transparent p-0`}
            data-slot={slot.key}
          >
            <img
              // Keyed by the chosen dish so React remounts the <img> on a tap,
              // re-triggering the pop-in transition for the fresh sticker.
              key={img}
              src={`/stickers/recipes/${img}.png`}
              alt=""
              aria-hidden
              className={`hero-sticker souso-sticker ${slot.h} w-auto object-contain`}
              style={{ '--rot': `${slot.rot}deg` } as React.CSSProperties}
            />
          </button>
        )
      })}
      <StickyNote tilt={6} className="absolute -top-2 right-1 z-10">
        no more &ldquo;what&rsquo;s for dinner?&rdquo;
      </StickyNote>
    </div>
  )
}
