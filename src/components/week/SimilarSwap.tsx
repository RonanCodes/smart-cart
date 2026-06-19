import { useEffect, useState } from 'react'
import { Clock, Flame } from 'lucide-react'
import type { SimilarSort } from '#/lib/vectors/similar'
import type { SimilarResponse } from '#/lib/similar-server'
import { Button } from '#/components/ui/button'

/** A neighbour as the list renders it (a slice of SimilarResponse.neighbours). */
export type SimilarNeighbour = SimilarResponse['neighbours'][number]

interface SimilarSwapProps {
  /** Load neighbours for this day's recipe under the given re-rank. */
  onLoad: (sort: SimilarSort) => Promise<Array<SimilarNeighbour>>
  /** The user picked a neighbour: write it into this day. */
  onPick: (recipeId: string) => void
  /** True while a pick is being persisted (locks the list). */
  picking: boolean
}

/** The three re-ranks the similar API supports, in tab order. */
const SORTS: Array<{ key: SimilarSort; label: string }> = [
  { key: 'similarity', label: 'Most similar' },
  { key: 'faster', label: 'Faster' },
  { key: 'lighter', label: 'Lighter' },
]

/**
 * The "swap for something similar" chooser. Distinct from the next-best Swap: it
 * shows the actual nearest-neighbour recipes (Vectorize, #31) so the replacement
 * stays close to the current dish ("like this, but a different night"). A re-rank
 * toggle surfaces the faster / lighter sorts the similar API supports.
 *
 * Mobile-first: every row is a full-width tappable button and the sort toggle is
 * tappable too, so there is no hover-only affordance and it works on touch at
 * 390px. Rendered inline inside the day card (no Dialog/Sheet primitive in the
 * UI kit), expanded on demand.
 */
export function SimilarSwap({ onLoad, onPick, picking }: SimilarSwapProps) {
  const [sort, setSort] = useState<SimilarSort>('similarity')
  const [neighbours, setNeighbours] = useState<Array<SimilarNeighbour> | null>(
    null,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(false)
    onLoad(sort)
      .then((rows) => {
        if (live) setNeighbours(rows)
      })
      .catch(() => {
        if (live) setError(true)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [sort, onLoad])

  return (
    <div className="border-border mt-2 space-y-3 rounded-lg border p-3">
      <div
        role="tablist"
        aria-label="Re-rank similar recipes"
        className="flex gap-1.5"
      >
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={sort === s.key}
            disabled={picking}
            onClick={() => setSort(s.key)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              sort === s.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-muted-foreground py-2 text-center text-xs">
          Finding similar dinners…
        </p>
      )}

      {error && (
        <p className="text-muted-foreground py-2 text-center text-xs">
          Could not load similar dinners, try again.
        </p>
      )}

      {!loading && !error && neighbours?.length === 0 && (
        <p className="text-muted-foreground py-2 text-center text-xs">
          No similar dinners found.
        </p>
      )}

      {!loading && !error && neighbours && neighbours.length > 0 && (
        <ul className="space-y-1.5">
          {neighbours.map((n) => (
            <li key={n.id}>
              <Button
                variant="outline"
                size="sm"
                className="h-auto w-full flex-col items-start gap-1 py-2 text-left whitespace-normal"
                disabled={picking}
                onClick={() => onPick(n.id)}
              >
                <span className="text-sm font-semibold">{n.title}</span>
                <span className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-normal">
                  {n.cuisine && <span>{n.cuisine}</span>}
                  {n.prepMinutes != null && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {n.prepMinutes} min
                    </span>
                  )}
                  {n.calories != null && (
                    <span className="inline-flex items-center gap-1">
                      <Flame className="h-3 w-3" />
                      {n.calories} kcal
                    </span>
                  )}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
