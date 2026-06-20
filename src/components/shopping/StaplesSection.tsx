import { useRef, useState } from 'react'
import { Plus, Search, Trash2, X } from 'lucide-react'
import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import { Badge } from '#/components/ui/badge'
import { searchStaples, addStaple, removeStaple } from '#/lib/staples-server'
import type {
  StapleSearchResult,
  StapleLine,
  FrequentStaple,
} from '#/lib/staples-server'

/**
 * "Add your staples" on the Shopping tab (#124, PRD step 4).
 *
 * Three pieces, stacked mobile-first (390px), warm + food-forward to match Souso:
 *  1. A search bar: type a product (milk, coffee, toilet paper) -> live matches
 *     from the AH / Jumbo catalogue with their price -> tap to add to the week.
 *  2. A "frequently bought" quick-add row of common staples for one-tap adds.
 *  3. The household's saved staples, which persist across sessions and sit
 *     alongside the recipe ingredients in the same week's list.
 *
 * The saved list is owned here as local state seeded from the loader, then kept
 * in sync from each add/remove server-fn response (no full-page reload).
 */
export function StaplesSection({
  initialStaples,
  frequentlyBought,
}: {
  initialStaples: Array<StapleLine>
  frequentlyBought: Array<FrequentStaple>
}) {
  const [staples, setStaples] = useState<Array<StapleLine>>(initialStaples)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<StapleSearchResult>>([])
  const [searching, setSearching] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const savedKeys = new Set(staples.map((s) => `${s.store}:${s.name}`))

  function onQueryChange(value: string) {
    setQuery(value)
    if (debounce.current) clearTimeout(debounce.current)
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounce.current = setTimeout(() => {
      void runSearch(trimmed)
    }, 220)
  }

  async function runSearch(q: string) {
    try {
      const { results: hits } = await searchStaples({ data: { query: q } })
      setResults(hits)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  function clearSearch() {
    setQuery('')
    setResults([])
    setSearching(false)
    if (debounce.current) clearTimeout(debounce.current)
  }

  async function add(result: StapleSearchResult) {
    setBusyKey(result.productKey)
    try {
      const { staples: next } = await addStaple({ data: result })
      setStaples(next)
      clearSearch()
    } catch {
      // Swallow; the list simply does not change. A toast layer can hook in later.
    } finally {
      setBusyKey(null)
    }
  }

  async function remove(id: string) {
    setBusyKey(id)
    try {
      const { staples: next } = await removeStaple({ data: { id } })
      setStaples(next)
    } catch {
      // no-op
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <section aria-labelledby="staples-heading" className="space-y-3">
      <div>
        <h2
          id="staples-heading"
          className="text-sm font-semibold tracking-tight"
        >
          Add your staples
        </h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Milk, coffee, toilet paper. Search and tap to add to this week.
        </p>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          aria-label="Search products to add"
          placeholder="Search milk, coffee, snacks..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-12 pr-10 pl-9 text-base"
        />
        {query && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1.5"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {/* Search results */}
      {query.trim().length >= 2 && (
        <div
          role="listbox"
          aria-label="Search results"
          className="bg-card border-border divide-border divide-y overflow-hidden rounded-[var(--radius-ios)] border"
        >
          {searching && results.length === 0 && (
            <p className="text-muted-foreground px-4 py-3 text-sm">
              Searching...
            </p>
          )}
          {!searching && results.length === 0 && (
            <p className="text-muted-foreground px-4 py-3 text-sm">
              No products found. Try another word.
            </p>
          )}
          {results.map((r) => {
            const already = savedKeys.has(`${r.store}:${r.name}`)
            return (
              <button
                key={r.productKey}
                type="button"
                role="option"
                aria-selected={already}
                disabled={busyKey === r.productKey || already}
                onClick={() => add(r)}
                className="hover:bg-secondary/60 flex w-full items-center gap-3 px-4 py-3 text-left transition-colors disabled:opacity-60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.name}</p>
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {storeLabel(r.store)}
                    {r.size ? ` · ${r.size}` : ''}
                  </p>
                </div>
                {r.priceLabel && (
                  <span className="text-foreground shrink-0 text-sm font-semibold tabular-nums">
                    {r.priceLabel}
                  </span>
                )}
                <span
                  className={
                    already
                      ? 'text-muted-foreground shrink-0'
                      : 'text-primary shrink-0'
                  }
                  aria-hidden
                >
                  {already ? 'Added' : <Plus className="h-5 w-5" />}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Frequently bought quick-add */}
      {frequentlyBought.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium">
            Frequently bought
          </p>
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            {frequentlyBought.map((f) => {
              const already = savedKeys.has(
                `${f.result.store}:${f.result.name}`,
              )
              return (
                <button
                  key={f.result.productKey}
                  type="button"
                  disabled={busyKey === f.result.productKey || already}
                  onClick={() => add(f.result)}
                  className="border-border bg-card hover:bg-secondary/60 flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-60"
                >
                  {already ? (
                    <span className="text-muted-foreground text-xs">Added</span>
                  ) : (
                    <Plus className="text-primary h-4 w-4" aria-hidden />
                  )}
                  <span>{f.label}</span>
                  {f.result.priceLabel && (
                    <span className="text-muted-foreground tabular-nums">
                      {f.result.priceLabel}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Saved staples */}
      {staples.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">On your list</p>
            <Badge variant="primary">{staples.length}</Badge>
          </div>
          <div className="bg-card border-border divide-border divide-y overflow-hidden rounded-[var(--radius-ios)] border">
            {staples.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {storeLabel(s.store)} · staple
                  </p>
                </div>
                {s.priceLabel && (
                  <span className="text-foreground shrink-0 text-sm font-semibold tabular-nums">
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
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** Friendly store label for the demo's two stores; falls back to the slug. */
function storeLabel(store: string): string {
  if (store === 'ah') return 'Albert Heijn'
  if (store === 'jumbo') return 'Jumbo'
  return store
}
