import { useEffect, useRef, useState } from 'react'
import {
  Search,
  Clock,
  Flame,
  Plus,
  Minus,
  X,
  Heart,
  Package,
  Check,
  Loader2,
  ChefHat,
} from 'lucide-react'
import { cn } from '#/lib/utils'
import { searchCatalogue, browseRecipes } from '#/lib/search-server'
import type {
  SearchRecipe,
  SearchProduct,
  SearchTheme,
} from '#/lib/search-server'
import type { RecipeDetailResult } from '#/lib/recipe-detail-server'
import { addShoppingItem } from '#/lib/shopping-list-server'
import { Sheet } from '#/components/ui/sheet'
import { Button } from '#/components/ui/button'
import { StickyNote } from '#/components/ui/sticky-note'
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

      {/* Recipe detail sheet — the /design/recipe layout against the real recipe:
          cream hero + title + facts + ingredient stickers + steps, with an
          "Add all" pill and a serves stepper, opened from any card. Keyed by the
          recipe id so its serves/add state resets cleanly per dish. */}
      <RecipeDetailSheet
        key={openRecipe?.id ?? 'closed'}
        recipe={openRecipe}
        liked={openRecipe ? liked.has(openRecipe.id) : false}
        onClose={() => setOpenRecipe(null)}
      />
    </>
  )
}

/**
 * The Search recipe sheet aligned to the /design/recipe prototype, against the
 * real catalogue recipe. The cream layout: a die-cut hero sticker (with an
 * optional "a household favourite" note when the user has liked it), the bold
 * title + a one-line factual subtitle, then the shared RecipeDetail card (facts /
 * ingredient stickers / numbered steps) driven with a serves stepper and an
 * "Add all" pill, plus a sticky bottom bar carrying the stepper and a Cook CTA.
 *
 * The detail data is fetched ONCE by RecipeDetail; it reports back via onLoaded
 * so this sheet can seed the serves stepper from the recipe's own serving count,
 * and the "Add all" pill calls back with the (scaled) ingredient list to write.
 */
function RecipeDetailSheet({
  recipe,
  liked,
  onClose,
}: {
  recipe: SearchRecipe | null
  liked: boolean
  onClose: () => void
}) {
  const [serves, setServes] = useState<number | null>(null)
  const [addState, setAddState] = useState<'idle' | 'busy' | 'done'>('idle')
  // Guard against a double-add if the user taps "Add all" twice mid-write.
  const inflight = useRef(false)

  function handleLoaded(d: RecipeDetailResult) {
    // Seed the stepper from the recipe's own base; default to 2 when unknown so
    // the control is still usable (it just won't rescale amounts without a base).
    setServes((prev) => prev ?? d.servings ?? 2)
  }

  async function addAll(
    ingredients: ReadonlyArray<{ name: string; amount: string | null }>,
  ) {
    if (addState !== 'idle' || inflight.current || ingredients.length === 0)
      return
    inflight.current = true
    setAddState('busy')
    try {
      // "Add all" is the explicit action that puts items in the cart (the
      // inclusion model the week page uses), so adding here respects the rule
      // that nothing enters the basket without a deliberate tap.
      for (const ing of ingredients) {
        await addShoppingItem({
          data: { name: ing.name, amount: ing.amount },
        })
      }
      setAddState('done')
    } catch {
      // Leave it addable so the user can retry.
      setAddState('idle')
    } finally {
      inflight.current = false
    }
  }

  // A grounded one-line subtitle from real facts only (cuisine + prep time);
  // omitted when the recipe carries neither, so nothing is fabricated.
  const subtitleParts: Array<string> = []
  if (recipe?.cuisine) subtitleParts.push(recipe.cuisine)
  if (recipe?.prepMinutes != null)
    subtitleParts.push(`ready in ${recipe.prepMinutes} minutes`)
  const subtitle = subtitleParts.join(' · ')

  return (
    <Sheet
      open={recipe !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className="bg-background text-foreground"
    >
      {/* Hero + title + subtitle. The sheet's own centred header is left empty
          (no title prop) so the big bold title reads as the design intends. */}
      {recipe && (
        <div className="-mt-1 pb-2">
          {recipe.imageUrl && (
            <div className="relative flex justify-center pt-1 pb-1">
              <img
                src={recipe.imageUrl}
                alt={recipe.title}
                className="souso-sticker h-44 w-44 object-contain"
                style={{ transform: 'rotate(-4deg)' }}
              />
              {liked && (
                <StickyNote
                  tilt={6}
                  className="absolute top-2 right-1 text-[0.9rem]"
                >
                  a household favourite ✶
                </StickyNote>
              )}
            </div>
          )}

          <h1
            className="text-center text-[1.7rem] leading-tight font-bold"
            style={{ letterSpacing: '-0.03em' }}
          >
            {recipe.title}
          </h1>
          {subtitle && (
            <p className="text-muted-foreground mt-1 text-center text-sm">
              {subtitle}
            </p>
          )}

          <RecipeDetail
            recipeId={recipe.id}
            active
            calories={recipe.calories}
            protein={recipe.protein}
            onLoaded={handleLoaded}
            serves={serves ?? undefined}
            onAddAll={addAll}
            addAllState={addState}
          />

          <RecipeFacts
            recipeId={recipe.id}
            title={recipe.title}
            cuisine={recipe.cuisine}
            active
          />

          {/* Bottom bar: serves stepper + Cook. Pinned within the sheet so it
              stays in view as the recipe scrolls. The stepper rescales the
              ingredient amounts client-side via RecipeDetail's `serves`. */}
          <div className="bg-background/95 sticky bottom-0 -mx-5 mt-4 px-5 pt-3 pb-1 backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="border-border flex items-center gap-3 rounded-full border px-2 py-1.5">
                <button
                  type="button"
                  aria-label="Fewer servings"
                  onClick={() => setServes((s) => Math.max(1, (s ?? 2) - 1))}
                  className="text-muted-foreground flex h-7 w-7 items-center justify-center"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-12 text-center text-sm font-semibold tabular-nums">
                  {serves ?? 2} serves
                </span>
                <button
                  type="button"
                  aria-label="More servings"
                  onClick={() => setServes((s) => (s ?? 2) + 1)}
                  className="text-primary flex h-7 w-7 items-center justify-center"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {/* Cook: kept from the design for layout, but there is no cook-mode
                  route yet, so it is a clearly-secondary, disabled affordance
                  rather than an invented flow. The real explicit action is the
                  "Add all" pill in the Ingredients header above. */}
              <Button
                size="pill"
                variant="secondary"
                className="flex-1"
                disabled
                aria-label="Cook (coming soon)"
              >
                <ChefHat className="h-5 w-5" />
                Cook
              </Button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
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
