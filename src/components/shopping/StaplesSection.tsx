import { useEffect, useRef, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { removeStaple } from '#/lib/staples-server'
import type { StapleLine } from '#/lib/staples-server'
import { StoreBadge } from '#/components/shopping/StoreBadge'

/**
 * "On your list" on the Shopping tab (#124, PRD step 4).
 *
 * Shows the household's saved staples, which persist across sessions and sit
 * alongside the recipe ingredients in the same week's list. Staples are now
 * ADDED from the Search / discover screen, so this section is read-only here:
 * each row has the in-order tick (include / exclude) and a remove button.
 *
 * The saved list is owned here as local state seeded from the loader, then kept
 * in sync from each remove server-fn response (no full-page reload).
 */
export function StaplesSection({
  initialStaples,
  onStaplesChange,
  onCheckedChange,
}: {
  initialStaples: Array<StapleLine>
  /**
   * Fired whenever the saved staples change (remove). The route lifts this up so
   * the price comparison + the single cart action include the extras and
   * recompute when one is removed (#311). Optional, so the empty-state usage (no
   * comparison below it) can omit it.
   */
  onStaplesChange?: (staples: Array<StapleLine>) => void
  /**
   * Fired whenever the set of SELECTED (in-order) extra ids changes. A selected
   * extra is included in every store's basket AND in the cart, exactly like a
   * checked recipe line (#311). Optional for the same reason.
   */
  onCheckedChange?: (selectedIds: Set<string>) => void
}) {
  const [staples, setStaples] = useState<Array<StapleLine>>(initialStaples)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  // Client-only "in my order" selection for the extras. Staples have no
  // persisted checked column, so this lives in the page session: selecting one
  // includes it in the comparison + the cart, unselecting drops it (#311). A
  // freshly added staple starts selected (in the order) by default.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialStaples.map((s) => s.id)),
  )

  // Mirror staples + selected extras up to the route (#311), once per committed
  // render including mount, so the siblings below start in sync.
  const onStaplesChangeRef = useRef(onStaplesChange)
  onStaplesChangeRef.current = onStaplesChange
  useEffect(() => {
    onStaplesChangeRef.current?.(staples)
  }, [staples])

  const onCheckedChangeRef = useRef(onCheckedChange)
  onCheckedChangeRef.current = onCheckedChange
  useEffect(() => {
    onCheckedChangeRef.current?.(selectedIds)
  }, [selectedIds])

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function remove(id: string) {
    setBusyKey(id)
    try {
      const { staples: next } = await removeStaple({ data: { id } })
      setStaples(next)
      // Drop the removed extra from the selected set so a stale id can never keep
      // a row that no longer exists in the order.
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev
        const nextSet = new Set(prev)
        nextSet.delete(id)
        return nextSet
      })
    } catch {
      // no-op
    } finally {
      setBusyKey(null)
    }
  }

  // No staples saved: nothing to show here. Staples are added from the Search
  // screen, so an empty list should render nothing (no empty heading).
  if (staples.length === 0) return null

  return (
    <section aria-labelledby="staples-heading" className="space-y-3">
      <h2 id="staples-heading" className="sr-only">
        Staples
      </h2>

      {/* Saved staples ("On your list"): in-order extras that join the basket +
          cart, so they belong with the cart. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">On your list</p>
          <Badge variant="primary">{staples.length}</Badge>
        </div>
        <div className="bg-card border-border divide-border divide-y overflow-hidden rounded-[var(--radius-ios)] border">
          {staples.map((s) => {
            const selected = selectedIds.has(s.id)
            return (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                {/* Tick = "in my order": includes the extra in the basket +
                    the cart, like a checked recipe line (#311). */}
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  aria-label={
                    selected
                      ? `Remove ${s.name} from your order`
                      : `Add ${s.name} to your order`
                  }
                  onClick={() => toggleSelected(s.id)}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
                    selected
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-border bg-transparent'
                  }`}
                >
                  {selected && <Check className="h-4 w-4" aria-hidden />}
                </button>
                <StoreBadge
                  store={s.store}
                  slug={s.productSlug}
                  productName={s.name}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate font-medium ${
                      selected ? '' : 'text-muted-foreground'
                    }`}
                  >
                    {s.name}
                  </p>
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {storeLabel(s.store)} · staple
                  </p>
                </div>
                {s.priceLabel && (
                  <span
                    className={`shrink-0 text-sm font-semibold tabular-nums ${
                      selected ? 'text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    {s.priceLabel}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={busyKey === s.id}
                  aria-label={`Remove ${s.name}`}
                  onClick={() => remove(s.id)}
                >
                  <Trash2
                    className="text-muted-foreground h-4 w-4"
                    aria-hidden
                  />
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** Friendly store label for the demo's two stores; falls back to the slug. */
function storeLabel(store: string): string {
  if (store === 'ah') return 'Albert Heijn'
  if (store === 'jumbo') return 'Jumbo'
  return store
}
