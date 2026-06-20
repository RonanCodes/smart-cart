import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { runMatchScenario } from '#/lib/pricing/match-server'
import type { MatchScenarioResult } from '#/lib/pricing/match-server'

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
        <input
          value={ingredient}
          onChange={(e) => setIngredient(e.target.value)}
          placeholder="e.g. mushroom"
          className="border-border focus:border-primary flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-95 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Match'}
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => void run(p)}
            className="border-border text-muted-foreground hover:text-foreground rounded-full border px-3 py-1 text-xs transition"
          >
            {p}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      {result && !result.keyPresent && (
        <p className="text-sm text-amber-600">
          No OPENAI_API_KEY set, so the query cannot be embedded. Add the key to
          run live matching (ADR-0004 keyless contract).
        </p>
      )}

      {result && result.keyPresent && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Pick title="Cheap tier (cosine top-1)" hit={result.cheap} />
            <Pick title="Accurate tier (LLM rerank)" hit={result.reranked} />
          </div>

          <div>
            <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
              Retrieved candidates
            </h3>
            <ul className="border-border divide-border divide-y rounded-lg border text-sm">
              {result.candidates.length === 0 && (
                <li className="text-muted-foreground p-3">
                  No candidates above the floor.
                </li>
              )}
              {result.candidates.map((c, i) => (
                <li key={i} className="flex items-center justify-between p-2.5">
                  <span>{c.name}</span>
                  <span className="text-muted-foreground tabular-nums">
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
}: {
  title: string
  hit: MatchScenarioResult['cheap'] | null
}) {
  return (
    <div className="border-border rounded-lg border p-3">
      <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        {title}
      </h3>
      {!hit || !hit.name ? (
        <p className="text-muted-foreground text-sm">No match</p>
      ) : (
        <>
          <p className="text-foreground text-sm font-medium">{hit.name}</p>
          <p className="text-muted-foreground mt-0.5 text-sm tabular-nums">
            {euro(hit.priceCents)} &middot;{' '}
            <span className={confColor(hit.confidence)}>{hit.confidence}</span>{' '}
            &middot; {hit.score.toFixed(3)}
          </p>
        </>
      )}
    </div>
  )
}
