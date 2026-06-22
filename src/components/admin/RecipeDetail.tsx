import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Sparkles, Video, ImageOff } from 'lucide-react'
import type { AdminRecipeCard } from '#/lib/admin-recipes-server'
import { getRecipeDetail } from '#/lib/admin-recipes-server'
import {
  getRecipeMedia,
  generateRecipeVideo,
  generateSousoKnows,
} from '#/lib/recipe-media-server'
import type { SousoKnows } from '#/lib/recipe-media-server'

/**
 * The recipe inspector detail: ingredients matched to AH SKUs with embedding
 * retrieval + rerank validation, a "Souso knows" health/food panel, and a
 * Pixverse cooking video. Both generate buttons hit cache-first server fns, so a
 * second load reads the cached value and never re-calls the API.
 */

function euro(cents: number | null): string {
  return cents === null ? '-' : `EUR ${(cents / 100).toFixed(2)}`
}

function confColor(c: string): string {
  if (c === 'high') return 'text-green-600'
  if (c === 'medium') return 'text-amber-600'
  if (c === 'low') return 'text-orange-600'
  return 'text-muted-foreground'
}

export function RecipeDetail({ recipe }: { recipe: AdminRecipeCard }) {
  const detailQuery = useQuery({
    queryKey: ['admin', 'recipe-detail', recipe.id],
    queryFn: () => getRecipeDetail({ data: { recipeId: recipe.id } }),
  })
  const mediaQuery = useQuery({
    queryKey: ['admin', 'recipe-media', recipe.id],
    queryFn: () => getRecipeMedia({ data: { recipeId: recipe.id } }),
  })

  const detail = detailQuery.data
  const media = mediaQuery.data

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="bg-secondary aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl sm:w-64">
          {recipe.imageUrl ? (
            <img
              src={recipe.imageUrl}
              alt={recipe.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground flex h-full w-full items-center justify-center">
              <ImageOff className="h-7 w-7" aria-hidden />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h2 className="text-foreground text-xl font-semibold">
            {recipe.title}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            <span className="uppercase">{recipe.source}</span>
            {recipe.cuisine ? ` · ${recipe.cuisine}` : ''}
            {detail?.servings ? ` · ${detail.servings} servings` : ''}
            {detail?.prepMinutes ? ` · ${detail.prepMinutes} min` : ''}
          </p>
        </div>
      </div>

      <IngredientMatches detailQuery={detailQuery} />
      <SousoKnowsPanel
        recipeId={recipe.id}
        cached={media?.souso ?? null}
        loading={mediaQuery.isLoading}
        onGenerated={() => void mediaQuery.refetch()}
      />
      <VideoPanel
        recipeId={recipe.id}
        cachedUrl={media?.videoUrl ?? null}
        loading={mediaQuery.isLoading}
        onGenerated={() => void mediaQuery.refetch()}
      />
    </div>
  )
}

function IngredientMatches({
  detailQuery,
}: {
  detailQuery: ReturnType<
    typeof useQuery<Awaited<ReturnType<typeof getRecipeDetail>>>
  >
}) {
  const detail = detailQuery.data
  return (
    <section>
      <h3 className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
        Ingredients to Albert Heijn SKUs
      </h3>
      {detailQuery.isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Matching ingredients...
        </p>
      ) : !detail ? (
        <p className="text-muted-foreground text-sm">Recipe not found.</p>
      ) : (
        <>
          {!detail.matchKeyPresent && (
            <p className="mb-2 text-xs text-amber-600">
              No OPENAI_API_KEY set, so ingredients show without SKU matches.
            </p>
          )}
          {detail.matches.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No ingredients on this recipe.
            </p>
          ) : (
            <ul className="border-border divide-border divide-y rounded-lg border text-sm">
              {detail.matches.map((m, i) => (
                <li
                  key={`${m.ingredient}-${i}`}
                  className="flex items-center justify-between gap-3 p-2.5"
                >
                  <span className="min-w-0">
                    <span className="text-foreground">{m.ingredient}</span>
                    {m.productName ? (
                      <span className="text-muted-foreground">
                        {' '}
                        &rarr; {m.productName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {' '}
                        &rarr; no match
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="text-muted-foreground">
                      {euro(m.priceCents)}
                    </span>{' '}
                    <span className={confColor(m.confidence)}>
                      {m.confidence}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function SousoKnowsPanel({
  recipeId,
  cached,
  loading,
  onGenerated,
}: {
  recipeId: string
  cached: SousoKnows | null
  loading: boolean
  onGenerated: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SousoKnows | null>(null)
  const souso = result ?? cached

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const r = await generateSousoKnows({ data: { recipeId } })
      setResult(r)
      onGenerated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Souso knows
        </h3>
        <button
          onClick={() => void run()}
          disabled={busy || loading}
          className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition active:scale-95 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Generate Souso knows
        </button>
      </div>
      {error && <p className="text-sm text-red-600">Error: {error}</p>}
      {souso ? (
        <div className="border-border rounded-lg border p-3">
          <p className="text-foreground text-sm leading-relaxed">
            {souso.content}
          </p>
          {souso.sources.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {souso.sources.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary text-xs underline"
                  >
                    {s.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground mt-2 text-[10px] uppercase">
            Source: {souso.source === 'cala' ? 'CALA' : 'LLM fallback'}
          </p>
        </div>
      ) : (
        !busy && (
          <p className="text-muted-foreground text-sm">
            Nothing cached yet. Generate to fetch food facts (cached after).
          </p>
        )
      )}
    </section>
  )
}

function VideoPanel({
  recipeId,
  cachedUrl,
  loading,
  onGenerated,
}: {
  recipeId: string
  cachedUrl: string | null
  loading: boolean
  onGenerated: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const videoUrl = url ?? cachedUrl

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const r = await generateRecipeVideo({ data: { recipeId } })
      if (r.videoUrl) {
        setUrl(r.videoUrl)
        onGenerated()
      } else {
        setError(r.error ?? 'Video generation failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Cooking video
        </h3>
        <button
          onClick={() => void run()}
          disabled={busy || loading}
          className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition active:scale-95 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Video className="h-3.5 w-3.5" />
          )}
          Generate video
        </button>
      </div>
      {busy && (
        <p className="text-muted-foreground text-sm">
          Pixverse is generating the clip. This can take a few minutes.
        </p>
      )}
      {error && <p className="text-sm text-amber-600">{error}</p>}
      {videoUrl ? (
        <video
          src={videoUrl}
          controls
          playsInline
          className="border-border w-full max-w-md rounded-lg border"
        />
      ) : (
        !busy &&
        !error && (
          <p className="text-muted-foreground text-sm">
            No video cached yet. Generate to make a short cooking clip (cached
            after).
          </p>
        )
      )}
    </section>
  )
}
