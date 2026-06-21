import { useEffect, useState } from 'react'
import { Sparkles, Loader2, ExternalLink } from 'lucide-react'
import { getRecipeFacts } from '#/lib/recipe-facts-server'
import type { CalaSource } from '#/lib/cala'

interface RecipeFactsProps {
  /** The recipe to fetch facts for; the cache key on the server. */
  recipeId: string
  /** The dish title, woven into the Cala question. */
  title: string
  /** Cuisine label when known, sharpens the question. */
  cuisine?: string | null
  /**
   * Gate the fetch. The card lives inside the edit sheet, so it only fetches
   * once that sheet is open (lazy, on demand) rather than on every week render.
   */
  active: boolean
}

interface FactsState {
  content: string | null
  sources: Array<CalaSource>
}

/**
 * "Souso knows" — a small source-cited facts card for the day's dish (#Cala).
 * Asks Cala (cala.ai) for one or two verifiable facts about the dish or its key
 * ingredients and renders them with citation chips that link to the real source
 * URLs. This is the AI-grounding demo beat: real cited web knowledge, not a
 * hallucination (Souso's hard rule).
 *
 * Lazy + invisible-by-default: it fetches only when `active` (the sheet is open)
 * and renders NOTHING until it has content. So when the key is unconfigured, or
 * Cala has no facts, the card never appears (no empty box, no error state). The
 * one-credit-per-recipe cost is paid once then cached server-side.
 *
 * Imports only the createServerFn (the handler body is stripped from the client
 * bundle) + the CalaSource type, so nothing server-only leaks here.
 */
export function RecipeFacts({
  recipeId,
  title,
  cuisine,
  active,
}: RecipeFactsProps) {
  const [loading, setLoading] = useState(false)
  const [facts, setFacts] = useState<FactsState | null>(null)
  // Remember which recipe we loaded so re-opening the same day doesn't refetch
  // (the server caches anyway, this just skips the round-trip within a session).
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!active || !recipeId) return
    if (loadedFor === recipeId) return

    let cancelled = false
    setLoading(true)
    setFacts(null)
    void getRecipeFacts({ data: { recipeId, title, cuisine } })
      .then((res) => {
        if (cancelled) return
        setFacts(res)
        setLoadedFor(recipeId)
      })
      .catch(() => {
        // Degrade to hidden: a failed fetch leaves facts null, card stays gone.
        if (!cancelled) setFacts({ content: null, sources: [] })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [active, recipeId, title, cuisine, loadedFor])

  // While loading, show a tiny inline hint (it sits under the swap list, so a
  // small line reads as "Souso is finding facts" rather than a blocking spinner).
  if (active && loading && loadedFor !== recipeId) {
    return (
      <div className="text-muted-foreground mt-4 flex items-center gap-2 text-xs">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Souso is looking something up...
      </div>
    )
  }

  // No content (unconfigured key, no facts, or an error): render nothing.
  if (!facts?.content) return null

  return (
    <section className="border-border bg-secondary/40 mt-4 rounded-xl border p-3">
      <div className="text-foreground mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="text-primary h-4 w-4" aria-hidden />
        Souso knows
      </div>
      <p className="text-foreground/90 text-sm leading-snug">{facts.content}</p>

      {facts.sources.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {facts.sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="border-border bg-card text-muted-foreground hover:bg-secondary active:bg-secondary inline-flex max-w-[12rem] items-center gap-1 truncate rounded-full border px-2.5 py-1 text-xs transition-colors"
            >
              <ExternalLink className="h-3 w-3 flex-shrink-0" aria-hidden />
              <span className="truncate">{s.name}</span>
            </a>
          ))}
        </div>
      )}
    </section>
  )
}
