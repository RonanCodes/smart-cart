import { useMemo, useState } from 'react'
import { BookOpen, ChevronLeft, ImageOff } from 'lucide-react'
import type { AdminRecipeCard } from '#/lib/admin-recipes-server'
import { RecipeDetail } from '#/components/admin/RecipeDetail'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'

/**
 * Admin "Recipes" inspector. A scrollable grid of every recipe (image, title,
 * source badge, cuisine) with sort/filter by source and cuisine. Tapping a card
 * opens an in-panel detail (the recipe's ingredients matched to AH SKUs, a Souso
 * knows panel, and a Pixverse cooking video), matching the master-detail shape
 * the other admin tabs use. Read-only browse; the detail's generate buttons cache
 * their results so an API call never repeats.
 */

const ALL = '__all__'

function sourceBadgeClass(source: string): string {
  if (source === 'ah') return 'bg-[#00ade6] text-white'
  if (source === 'jumbo') return 'bg-[#eab90c] text-black'
  return 'bg-secondary text-muted-foreground'
}

export function RecipesPanel({ recipes }: { recipes: Array<AdminRecipeCard> }) {
  const [selected, setSelected] = useState<AdminRecipeCard | null>(null)
  const [source, setSource] = useState<string>(ALL)
  const [cuisine, setCuisine] = useState<string>(ALL)

  const sources = useMemo(
    () => [...new Set(recipes.map((r) => r.source))].sort(),
    [recipes],
  )
  const cuisines = useMemo(
    () =>
      [
        ...new Set(recipes.map((r) => r.cuisine).filter(Boolean)),
      ].sort() as Array<string>,
    [recipes],
  )

  const filtered = useMemo(
    () =>
      recipes.filter(
        (r) =>
          (source === ALL || r.source === source) &&
          (cuisine === ALL || r.cuisine === cuisine),
      ),
    [recipes, source, cuisine],
  )

  if (selected) {
    return (
      <div className="pb-10">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelected(null)}
          className="text-muted-foreground hover:text-foreground mb-4 -ml-2"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden /> All recipes
        </Button>
        <RecipeDetail recipe={selected} />
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h2 className="text-foreground flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5" aria-hidden /> Recipes
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Browse every recipe in the catalogue. Open one to see its ingredient
          to SKU matches, what Souso knows, and a cooking video.
        </p>
      </div>

      <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Source</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="border-input bg-background focus-visible:ring-ring h-9 rounded-lg border px-2.5 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <option value={ALL}>All</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Cuisine</span>
          <select
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
            className="border-input bg-background focus-visible:ring-ring h-9 rounded-lg border px-2.5 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <option value={ALL}>All</option>
            {cuisines.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <span className="text-muted-foreground ml-auto text-xs">
          {filtered.length} of {recipes.length}
        </span>
      </Card>

      {filtered.length === 0 ? (
        <Card className="text-muted-foreground p-8 text-center text-sm">
          No recipes match.
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((r) => (
            <li key={r.id}>
              <Card
                pressable
                role="button"
                tabIndex={0}
                onClick={() => setSelected(r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelected(r)
                  }
                }}
                className="hover:ring-primary/40 group block w-full cursor-pointer overflow-hidden p-0 text-left hover:ring-2"
              >
                <div className="bg-secondary aspect-[4/3] w-full overflow-hidden">
                  {r.imageUrl ? (
                    <img
                      src={r.imageUrl}
                      alt={r.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="text-muted-foreground flex h-full w-full items-center justify-center">
                      <ImageOff className="h-6 w-6" aria-hidden />
                    </div>
                  )}
                </div>
                <div className="space-y-1.5 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${sourceBadgeClass(
                        r.source,
                      )}`}
                    >
                      {r.source}
                    </span>
                    {r.cuisine ? (
                      <span className="text-muted-foreground truncate text-xs">
                        {r.cuisine}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-foreground line-clamp-2 text-sm font-medium">
                    {r.title}
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
