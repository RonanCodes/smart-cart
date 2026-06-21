import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Search,
  Clock,
  Flame,
  Plus,
  X,
  Heart,
  Package,
  Check,
} from 'lucide-react'
import { DesignShell } from '#/components/design/design-shell'
import { cn } from '#/lib/utils'

/**
 * DESIGN PREVIEW (throwaway) — /design/discover, the Search tab. A live search
 * bar over a browse view: before you type, recipes sit in horizontal theme rows
 * you can scroll through (each likeable with an outline heart). As you type, it
 * searches recipes AND store products (e.g. toilet paper) and lets you add them
 * straight away. The conversational "Ask Souso" stays on the week.
 */

interface Recipe {
  title: string
  img: string
  minutes: number
  kcal: number
  cuisine: string
  tags: Array<string>
}

interface Product {
  name: string
  sub: string
  price: string
  keywords: Array<string>
}

const RECIPES: Array<Recipe> = [
  {
    title: 'Chicken Orzo with Spinach',
    img: 'chicken-orzo',
    minutes: 25,
    kcal: 540,
    cuisine: 'Mediterranean',
    tags: ['quick', 'protein'],
  },
  {
    title: 'Chicken Skewers & Tomato Salad',
    img: 'chicken-skewers',
    minutes: 20,
    kcal: 610,
    cuisine: 'Greek',
    tags: ['quick', 'protein'],
  },
  {
    title: 'One-pan Tomato Pasta',
    img: 'one-pan-pasta',
    minutes: 20,
    kcal: 580,
    cuisine: 'Italian',
    tags: ['quick', 'veggie', 'budget'],
  },
  {
    title: 'Creamy Tuscan Orecchiette',
    img: 'orecchiette',
    minutes: 25,
    kcal: 640,
    cuisine: 'Italian',
    tags: ['quick', 'veggie'],
  },
  {
    title: 'Gnocchi in Romesco',
    img: 'gnocchi-romesco',
    minutes: 30,
    kcal: 650,
    cuisine: 'Spanish',
    tags: ['veggie'],
  },
  {
    title: 'Sheet-pan Roast Veg & Feta',
    img: 'roast-veg',
    minutes: 35,
    kcal: 480,
    cuisine: 'Vegetarian',
    tags: ['veggie', 'budget'],
  },
  {
    title: 'Veggie Lasagne',
    img: 'veggie-lasagne',
    minutes: 55,
    kcal: 600,
    cuisine: 'Italian',
    tags: ['veggie'],
  },
  {
    title: 'Apple Crumble',
    img: 'apple-crumble',
    minutes: 45,
    kcal: 420,
    cuisine: 'Dessert',
    tags: ['sweet', 'budget'],
  },
  {
    title: 'Seed Crackers',
    img: 'seed-crackers',
    minutes: 40,
    kcal: 180,
    cuisine: 'Snack',
    tags: ['sweet', 'veggie', 'budget'],
  },
]

const PRODUCTS: Array<Product> = [
  {
    name: 'Toilet paper',
    sub: 'Household · 8 rolls',
    price: '€4,49',
    keywords: ['toilet', 'paper', 'wc', 'household', 'tissue', 'roll'],
  },
]

const THEMES: Array<{ title: string; tag: string }> = [
  { title: 'Quick weeknights', tag: 'quick' },
  { title: 'Veggie favourites', tag: 'veggie' },
  { title: 'High protein', tag: 'protein' },
  { title: 'Budget-friendly', tag: 'budget' },
  { title: 'Something sweet', tag: 'sweet' },
]

export const Route = createFileRoute('/design/discover')({
  component: DesignSearch,
})

function DesignSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [liked, setLiked] = useState<ReadonlySet<string>>(new Set())
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())

  const q = query.trim().toLowerCase()
  const searching = q.length > 0

  const recipeResults = RECIPES.filter(
    (r) =>
      r.title.toLowerCase().includes(q) ||
      r.cuisine.toLowerCase().includes(q) ||
      r.tags.some((t) => t.includes(q)),
  )
  const productResults = PRODUCTS.filter(
    (p) =>
      p.name.toLowerCase().includes(q) || p.keywords.some((k) => k.includes(q)),
  )

  function toggleLike(title: string) {
    setLiked((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }
  function toggleAdd(name: string) {
    setAdded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <DesignShell>
      <header className="px-5 pt-4 pb-1">
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight">
          Search
        </h1>
      </header>

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

      {searching ? (
        /* ── Live results: products you can add + matching recipes ── */
        <div className="px-5 pt-5">
          {productResults.length === 0 && recipeResults.length === 0 ? (
            <div className="flex flex-col items-center pt-16 text-center">
              <div className="bg-secondary text-primary flex h-14 w-14 items-center justify-center rounded-full">
                <Search className="h-6 w-6" />
              </div>
              <p className="mt-4 font-semibold">
                No matches for &ldquo;{query}&rdquo;
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Try a recipe, a cuisine, or a product like &ldquo;toilet
                paper&rdquo;.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {productResults.length > 0 && (
                <section>
                  <h2 className="text-muted-foreground mb-2 text-[0.7rem] font-bold tracking-[0.16em] uppercase">
                    Products
                  </h2>
                  <div className="space-y-2">
                    {productResults.map((p) => {
                      const on = added.has(p.name)
                      return (
                        <div
                          key={p.name}
                          className="border-border bg-card flex items-center gap-3 rounded-2xl border p-2.5 shadow-sm"
                        >
                          <div className="bg-secondary text-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-xl">
                            <Package className="h-6 w-6" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[0.95rem] font-semibold">
                              {p.name}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {p.sub}
                            </p>
                          </div>
                          <span className="text-sm font-bold">{p.price}</span>
                          <button
                            type="button"
                            onClick={() => toggleAdd(p.name)}
                            aria-pressed={on}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95',
                              on
                                ? 'bg-primary text-primary-foreground'
                                : 'border-primary text-primary border',
                            )}
                          >
                            {on ? (
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
                    })}
                  </div>
                </section>
              )}

              {recipeResults.length > 0 && (
                <section>
                  <h2 className="text-muted-foreground mb-2 text-[0.7rem] font-bold tracking-[0.16em] uppercase">
                    Recipes
                  </h2>
                  <div className="grid grid-cols-2 gap-3 pb-4">
                    {recipeResults.map((item) => (
                      <RecipeCard
                        key={item.title}
                        item={item}
                        liked={liked.has(item.title)}
                        onLike={() => toggleLike(item.title)}
                        onOpen={() => navigate({ to: '/design/recipe' })}
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
          {THEMES.map((theme) => {
            const items = RECIPES.filter((r) => r.tags.includes(theme.tag))
            if (items.length === 0) return null
            return (
              <section key={theme.title} className="mt-5 first:mt-2">
                <h2 className="mb-2 px-5 text-[1.05rem] font-bold tracking-tight">
                  {theme.title}
                </h2>
                <div className="flex [scrollbar-width:none] gap-3 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  {items.map((item) => (
                    <RecipeCard
                      key={item.title}
                      item={item}
                      liked={liked.has(item.title)}
                      onLike={() => toggleLike(item.title)}
                      onOpen={() => navigate({ to: '/design/recipe' })}
                      className="w-40 shrink-0"
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </DesignShell>
  )
}

function RecipeCard({
  item,
  liked,
  onLike,
  onOpen,
  className,
}: {
  item: Recipe
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
          <img
            src={`/stickers/recipes/${item.img}.png`}
            alt={item.title}
            className="souso-sticker h-24 w-24 object-contain"
            style={{ transform: 'rotate(-4deg)' }}
          />
        </div>
        <span className="text-primary text-[0.58rem] font-bold tracking-[0.14em] uppercase">
          {item.cuisine}
        </span>
        <h3 className="mt-0.5 line-clamp-2 text-[0.92rem] leading-tight font-bold">
          {item.title}
        </h3>
        <div className="text-muted-foreground mt-1.5 flex items-center gap-3 text-[0.72rem]">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {item.minutes}m
          </span>
          <span className="inline-flex items-center gap-1">
            <Flame className="h-3.5 w-3.5" />
            {item.kcal}
          </span>
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
