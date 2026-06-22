import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { runMatchScenario } from '#/lib/pricing/match-server'
import type { MatchScenarioResult } from '#/lib/pricing/match-server'
import { StoreBadge } from '#/components/shopping/StoreBadge'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Card } from '#/components/ui/card'

/**
 * Admin "Matching" scenario runner (ADR-0004). Type an ingredient (or pick a
 * golden case) and see the embedding ingredient -> SKU matcher work: the cosine
 * top-K candidates, the cheap top-1, and the LLM-reranked pick side by side. This
 * is the demo proof that "mushroom" finds the Dutch "champignons" with no synonym
 * table, and the gap the other admin tabs do not cover (they measure the
 * recommender, not match quality).
 */

const PRESETS = ['mushroom', '00 flour', 'rice', 'minced beef', 'tarwebloem']

function euro(cents: number | null): string {
  return cents === null ? '-' : `EUR ${(cents / 100).toFixed(2)}`
}

function confColor(c: string): string {
  if (c === 'high') return 'text-green-600'
  if (c === 'medium') return 'text-amber-600'
  if (c === 'low') return 'text-orange-600'
  return 'text-muted-foreground'
}

export function MatchingPanel() {
  const [ingredient, setIngredient] = useState('mushroom')
  const [result, setResult] = useState<MatchScenarioResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(value: string) {
    const q = value.trim()
    if (!q) return
    setIngredient(q)
    setLoading(true)
    setError(null)
    try {
      const r = await runMatchScenario({ data: { ingredient: q, store: 'ah' } })
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h2 className="text-foreground flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="h-5 w-5" aria-hidden /> Ingredient to SKU
          matching
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Embedding match over the Albert Heijn catalogue. Cross-language by
          construction: an English ingredient finds the Dutch product, no
          synonym table.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run(ingredient)
        }}
        className="flex gap-2"
      >
        <Input
          value={ingredient}
          onChange={(e) => setIngredient(e.target.value)}
          placeholder="e.g. mushroom"
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={loading}
          size="sm"
          className="h-10 px-5"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Match'}
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void run(p)}
            className="text-muted-foreground hover:text-foreground h-8 rounded-full px-3 text-xs font-normal"
          >
            {p}
          </Button>
        ))}
      </div>

      {error && <p className="text-destructive text-sm">Error: {error}</p>}

      {result && !result.keyPresent && (
        <p className="text-sm text-amber-600">
          No OPENAI_API_KEY set, so the query cannot be embedded. Add the key to
          run live matching (ADR-0004 keyless contract).
        </p>
      )}

      {result && result.keyPresent && (
        <div className="space-y-4">
          {result.searchTerms.length > 1 && (
            <p className="text-muted-foreground text-xs">
              Search terms embedded:{' '}
              {result.searchTerms.map((t) => (
                <code
                  key={t}
                  className="bg-muted mr-1.5 rounded px-1 py-0.5 font-mono"
                >
                  {t}
                </code>
              ))}
            </p>
          )}
          {result.expandFallback && (
            <p className="text-xs text-amber-700">
              Dutch term expansion fell back to the raw ingredient (LLM error or
              no model).
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Pick
              title="Cheap tier (cosine top-1)"
              hit={result.cheap}
              store={result.store}
            />
            <Pick
              title="Accurate tier (LLM rerank)"
              hit={result.reranked}
              store={result.store}
            />
          </div>

          <div>
            <h3 className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
              Retrieved candidates
            </h3>
            <ul className="bg-card border-border divide-border divide-y overflow-hidden rounded-xl border text-sm">
              {result.candidates.length === 0 && (
                <li className="text-muted-foreground p-3">
                  No candidates above the floor.
                </li>
              )}
              {result.candidates.map((c) => (
                <li
                  key={c.productId}
                  className="flex items-center justify-between gap-3 p-2.5"
                >
                  <span className="min-w-0">
                    <span className="text-muted-foreground font-mono text-xs">
                      {c.productId}
                    </span>
                    <span className="text-muted-foreground mx-1.5">·</span>
                    {c.name}
                    {c.size ? (
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        ({c.size})
                      </span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {euro(c.priceCents)} &middot; {c.score.toFixed(3)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function Pick({
  title,
  hit,
  store,
}: {
  title: string
  hit: MatchScenarioResult['cheap'] | null
  /** The store the scenario ran against ('ah'), so the badge / link can resolve. */
  store: string
}) {
  return (
    <Card className="p-4">
      <h3 className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
        {title}
      </h3>
      {!hit || (!hit.name && !hit.declined) ? (
        <p className="text-muted-foreground text-sm">No match</p>
      ) : hit.declined ? (
        <>
          <p className="text-sm font-medium text-amber-700">Declined</p>
          {hit.reason ? (
            <p className="text-muted-foreground mt-1 text-xs leading-snug">
              {hit.reason}
            </p>
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">
              No candidate is a reasonable raw ingredient match.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <StoreBadge store={store} slug={hit.slug} productName={hit.name} />
            <p className="text-foreground text-sm font-medium">{hit.name}</p>
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm tabular-nums">
            {euro(hit.priceCents)} &middot;{' '}
            <span className={confColor(hit.confidence)}>{hit.confidence}</span>{' '}
            &middot; {hit.score.toFixed(3)}
          </p>
          {hit.reason ? (
            <p className="text-muted-foreground mt-1.5 text-xs leading-snug">
              {hit.reason}
            </p>
          ) : hit.llmFallback ? (
            <p className="mt-1.5 text-xs leading-snug text-amber-700">
              Cosine fallback — rerank LLM did not run (model error or no key).
            </p>
          ) : null}
        </>
      )}
    </Card>
  )
}
