import { useEffect, useRef, useState } from 'react'
import {
  Search,
  Clock,
  Flame,
  Plus,
  X,
  Heart,
  Package,
  Check,
  Loader2,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import { searchCatalogue, browseRecipes } from '#/lib/search-server'
import type {
  SearchRecipe,
  SearchProduct,
  SearchTheme,
} from '#/lib/search-server'
import { addShoppingItem } from '#/lib/shopping-list-server'
import { Sheet } from '#/components/ui/sheet'
import { RecipeDetail } from '#/components/week/RecipeDetail'
import { RecipeFacts } from '#/components/week/RecipeFacts'

/** How long after the last keystroke before we hit the search server fn. */
const DEBOUNCE_MS = 250

/**
 * SearchScreen — the Search tab (route /discover, labelled "Search" in the tab
 * bar). A live search bar over a browse view, backed by REAL data:
 *
 *  - Before you type: themed horizontal rows of recipes from the catalogue
 *    (browseRecipes), each likeable with an outline heart.
 *  - As you type (debounced): searchCatalogue returns matching recipes AND store
 *    products. A product can be added straight to the shopping list.
 *
 * Recipes open a bottom sheet with the same RecipeDetail + "Souso knows" cards
 * the week uses. Likes are local UI state (a lightweight affordance); persisting
 * them as swipes is out of scope here.
 */
export function SearchScreen() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [liked, setLiked] = useState<ReadonlySet<string>>(new Set())

  // Browse-by-theme rows (loaded once on mount, shown when the query is blank).
  const [themes, setThemes] = useState<Array<SearchTheme> | null>(null)
  // Live results for the debounced query.
  const [searching, setSearching] = useState(false)
  const [recipes, setRecipes] = useState<Array<SearchRecipe>>([])
  const [products, setProducts] = useState<Array<SearchProduct>>([])
  // The recipe the sheet is showing, or null when closed.
  const [openRecipe, setOpenRecipe] = useState<SearchRecipe | null>(null)

  const q = query.trim()

  // Debounce the query so we don't fire a server fn on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  // Browse rows once on mount. Degrades to empty (no rows) on any failure.
  useEffect(() => {
    let cancelled = false
    void browseRecipes()
      .then((res) => {
        if (!cancelled) setThemes(res.themes)
      })
      .catch(() => {
        if (!cancelled) setThemes([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Run the search whenever the debounced query changes. An empty query clears
  // results and shows the browse view.
  useEffect(() => {
    if (!debounced) {
      setSearching(false)
      setRecipes([])
      setProducts([])
      return
    }
    let cancelled = false
    setSearching(true)
    void searchCatalogue({ data: { query: debounced } })
      .then((res) => {
        if (cancelled) return
        setRecipes(res.recipes)
        setProducts(res.products)
      })
      .catch(() => {
        if (cancelled) return
        setRecipes([])
        setProducts([])
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  function toggleLike(id: string) {
    setLiked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isSearching = q.length > 0
  // While the debounce is still catching up, keep showing the spinner rather than
  // flashing "no matches" against stale (empty) results.
  const pending = isSearching && (searching || debounced !== q)
  const noMatches =
    isSearching && !pending && recipes.length === 0 && products.length === 0

  return (
    <>
      {/* Live search bar */}
      <div className="px-5 pt-2">
        <div className="border-border bg-card flex items-center gap-2.5 rounded-full border px-4 py-3 shadow-sm">
          <Search
            className="text-muted-foreground h-5 w-5 shrink-0"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes & products…"
            aria-label="Search recipes and products"
            className="placeholder:text-muted-foreground/70 w-full bg-transparent text-[0.95rem] outline-none"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="text-muted-foreground shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {isSearching ? (
        /* ── Live results: products you can add + matching recipes ── */
        <div className="px-5 pt-5">
          {pending ? (
            <div className="text-muted-foreground flex items-center gap-2 pt-6 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Searching…
            </div>
          ) : noMatches ? (
            <div className="flex flex-col items-center pt-16 text-center">
              <div className="bg-secondary text-primary flex h-14 w-14 items-center justify-center rounded-full">
                <Search className="h-6 w-6" />
              </div>
              <p className="mt-4 font-semibold">
                No matches for &ldquo;{q}&rdquo;
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Try a recipe, a cuisine, or a product like &ldquo;toilet
                paper&rdquo;.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {products.length > 0 && (
                <section>
                  <h2 className="text-muted-foreground mb-2 text-[0.7rem] font-bold tracking-[0.16em] uppercase">
                    Products
                  </h2>
                  <div className="space-y-2">
                    {products.map((p) => (
                      <ProductRow key={p.id} product={p} />
                    ))}
                  </div>
                </section>
              )}

              {recipes.length > 0 && (
                <section>
                  <h2 className="text-muted-foreground mb-2 text-[0.7rem] font-bold tracking-[0.16em] uppercase">
                    Recipes
                  </h2>
                  <div className="grid grid-cols-2 gap-3 pb-4">
                    {recipes.map((item) => (
                      <RecipeCard
                        key={item.id}
                        item={item}
                        liked={liked.has(item.id)}
                        onLike={() => toggleLike(item.id)}
                        onOpen={() => setOpenRecipe(item)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ── Browse: themed rows of recipes, scroll sideways, like with a heart ── */
        <div className="pt-4 pb-4">
          {themes === null ? (
            <div className="text-muted-foreground flex items-center gap-2 px-5 pt-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading recipes…
            </div>
          ) : (
            themes.map((theme) => (
              <section key={theme.title} className="mt-5 first:mt-2">
                <h2 className="mb-2 px-5 text-[1.05rem] font-bold tracking-tight">
                  {theme.title}
                </h2>
                <div className="flex [scrollbar-width:none] gap-3 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  {theme.recipes.map((item) => (
                    <RecipeCard
                      key={item.id}
                      item={item}
                      liked={liked.has(item.id)}
                      onLike={() => toggleLike(item.id)}
                      onOpen={() => setOpenRecipe(item)}
                      className="w-40 shrink-0"
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      )}

      {/* Recipe detail sheet — same RecipeDetail + "Souso knows" cards the week
          uses, opened from any card. Renders only while a recipe is selected. */}
      <Sheet
        open={openRecipe !== null}
        onOpenChange={(open) => {
          if (!open) setOpenRecipe(null)
        }}
        title={openRecipe?.title}
      >
        <div className="pb-2">
          {openRecipe?.imageUrl && (
            <img
              src={openRecipe.imageUrl}
              alt={openRecipe.title}
              className="souso-sticker bg-secondary mx-auto mb-2 h-40 w-40 object-contain"
            />
          )}
          {openRecipe && <RecipeDetail recipeId={openRecipe.id} active />}
          {openRecipe && (
            <RecipeFacts
              recipeId={openRecipe.id}
              title={openRecipe.title}
              cuisine={openRecipe.cuisine}
              active
            />
          )}
        </div>
      </Sheet>
    </>
  )
}

/** One store-product row with an "Add" toggle that writes to the shopping list. */
function ProductRow({ product }: { product: SearchProduct }) {
  const [added, setAdded] = useState(false)
  const [busy, setBusy] = useState(false)
  // Guard against a double-add if the user taps twice while the write is inflight.
  const inflight = useRef(false)

  async function add() {
    if (added || busy || inflight.current) return
    inflight.current = true
    setBusy(true)
    try {
      await addShoppingItem({ data: { name: product.name } })
      setAdded(true)
    } catch {
      // Leave it un-added so the user can retry.
    } finally {
      setBusy(false)
      inflight.current = false
    }
  }

  return (
    <div className="border-border bg-card flex items-center gap-3 rounded-2xl border p-2.5 shadow-sm">
      <div className="bg-secondary text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
        <Package className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[0.95rem] font-semibold">{product.name}</p>
        <p className="text-muted-foreground text-xs capitalize">
          {product.store}
          {product.unit ? ` · ${product.unit}` : ''}
        </p>
      </div>
      {product.price && (
        <span className="text-sm font-bold">{product.price}</span>
      )}
      <button
        type="button"
        onClick={add}
        disabled={busy || added}
        aria-pressed={added}
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95 disabled:opacity-70',
          added
            ? 'bg-primary text-primary-foreground'
            : 'border-primary text-primary border',
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : added ? (
          <>
            <Check className="h-3.5 w-3.5" /> Added
          </>
        ) : (
          <>
            <Plus className="h-3.5 w-3.5" /> Add
          </>
        )}
      </button>
    </div>
  )
}

function RecipeCard({
  item,
  liked,
  onLike,
  onOpen,
  className,
}: {
  item: SearchRecipe
  liked: boolean
  onLike: () => void
  onOpen: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'border-border bg-card relative flex flex-col rounded-3xl border p-3 shadow-sm',
        className,
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block text-left transition active:scale-[0.98]"
      >
        <div className="flex justify-center pt-1 pb-1">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.title}
              className="souso-sticker h-24 w-24 object-contain"
              style={{ transform: 'rotate(-4deg)' }}
            />
          ) : (
            <div className="bg-secondary text-primary flex h-24 w-24 items-center justify-center rounded-2xl">
              <Flame className="h-8 w-8" />
            </div>
          )}
        </div>
        {item.cuisine && (
          <span className="text-primary text-[0.58rem] font-bold tracking-[0.14em] uppercase">
            {item.cuisine}
          </span>
        )}
        <h3 className="mt-0.5 line-clamp-2 text-[0.92rem] leading-tight font-bold">
          {item.title}
        </h3>
        <div className="text-muted-foreground mt-1.5 flex items-center gap-3 text-[0.72rem]">
          {item.prepMinutes !== null && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {item.prepMinutes}m
            </span>
          )}
          {item.calories !== null && (
            <span className="inline-flex items-center gap-1">
              <Flame className="h-3.5 w-3.5" />
              {item.calories}
            </span>
          )}
        </div>
      </button>

      {/* Like — outline by default, fills olive when liked. */}
      <button
        type="button"
        onClick={onLike}
        aria-label={liked ? `Unlike ${item.title}` : `Like ${item.title}`}
        aria-pressed={liked}
        className="absolute top-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm transition active:scale-90"
      >
        <Heart
          className={cn(
            'h-4 w-4',
            liked ? 'text-primary' : 'text-muted-foreground',
          )}
          fill={liked ? 'currentColor' : 'none'}
          strokeWidth={2.2}
        />
      </button>
    </div>
  )
}
