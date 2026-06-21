/**
 * Eval gate for the ingredient -> SKU matcher (ADR-0004), wired to `pnpm eval`.
 *
 * The pre-push hook (.husky/pre-push) runs this ONLY when a push touches the
 * agent files (src/lib/{replan,pricing,embeddings}/, braintrust-ai.ts, models.ts),
 * so a regression in the matcher blocks the push while a design/docs push never
 * pays for it.
 *
 * Contract the hook depends on:
 *   - Exit non-zero ONLY on a real regression: the pass rate over the golden
 *     cases drops below THRESHOLD.
 *   - Exit 0 (self-skip) when OPENAI_API_KEY is absent, so a keyless contributor
 *     is never blocked. Prints a clear skip line.
 *
 * What it evals: the SAME pipeline match-server.ts runs, but built to be pure
 * Node (no Worker, no D1 binding). It loads the committed product vectors
 * (data/embeddings/products.json), decodes them, builds the candidate lookup
 * from the bundled catalogue, embeds each query (OpenAI), retrieves cosine
 * candidates, and LLM-reranks. Each case passes when the reranked product name
 * contains one of a small set of expected Dutch/English keywords (case-insensitive
 * substring), e.g. "mushroom" must resolve to a "champignon" product.
 *
 * Results report to Braintrust automatically: every embed / rerank call goes
 * through src/lib/braintrust-ai.ts (wrapAISDK + initLogger), so the spans show up
 * on the platform with no extra API calls. The EXIT CODE is always derived here
 * from the local pass rate, because the gate only cares about that.
 *
 * Run: pnpm eval   (loads .dev.vars for keys, like `set -a; source .dev.vars`)
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ProductVectorEntry } from '#/lib/embeddings/store'

// ---- env: self-load .dev.vars so `pnpm eval` works standalone ---------------
// The pre-push hook calls a bare `pnpm eval`, so we cannot rely on the caller
// having sourced .dev.vars. Load it here without a dependency (only fills keys
// that are not already set in the environment).
function loadDevVars(): void {
  const path = join(process.cwd(), '.dev.vars')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

loadDevVars()

// ---- the keyless self-skip (MUST be before any OpenAI call) ------------------
if (!process.env.OPENAI_API_KEY) {
  console.log('⏭️  skipping evals, no OPENAI_API_KEY')
  process.exit(0)
}

// THRESHOLD override for sanity-checking the exit-code logic:
//   EVAL_THRESHOLD=1 pnpm eval   -> forces a stricter bar to prove exit 1 works.
const THRESHOLD = Number(process.env.EVAL_THRESHOLD ?? '0.8')
const STORE = 'ah'
const TOP_K = 10

/** One golden case: a query and the keywords any acceptable match must contain. */
interface Case {
  ingredient: string
  /** Lower-cased substrings; the matched product passes if its name contains ANY. */
  expectAny: Array<string>
  /**
   * Lower-cased substrings the matched product must NOT contain (the wrong TYPE).
   * A case with these FAILS if the match is a Doritos/cake/ready-meal/etc., even
   * when an expectAny keyword also matched. A null/no-match never trips a reject.
   */
  rejectAny?: Array<string>
}

/**
 * Golden cases. Deliberately small (cost + speed): the headline cross-lingual
 * case plus a handful of obvious staples spanning English and Dutch queries.
 *
 * This exercises the ACCURATE tier (expand -> multi-query retrieval -> LLM
 * rerank) — the SAME pipeline `resolveLinesForStoreAccurate` runs for the cart,
 * so a pass here means the cart resolves these correctly. Needs a live
 * OPENAI_API_KEY (present in pre-push); self-skips with no key (see top of file).
 *
 * The `rejectAny` cases below are the real-world cart failures: a basic
 * ingredient must resolve to the right product TYPE and reject the snack / cake /
 * ready-meal / gluten-free-when-not-asked it used to match.
 */
const CASES: Array<Case> = [
  { ingredient: 'mushroom', expectAny: ['champignon'] },
  { ingredient: '00 flour', expectAny: ['bloem', 'meel', 'flour'] },
  { ingredient: 'tarwebloem', expectAny: ['bloem', 'tarwe'] },
  { ingredient: 'rice', expectAny: ['rijst'] },
  { ingredient: 'minced beef', expectAny: ['gehakt', 'rund'] },
  { ingredient: 'gehakt', expectAny: ['gehakt'] },
  { ingredient: 'milk', expectAny: ['melk'] },
  { ingredient: 'garlic', expectAny: ['knoflook'] },
  // --- real-world cart failures: right TYPE + reject junk -------------------
  {
    ingredient: 'chilli flakes',
    expectAny: ['vlok', 'flakes', 'chili', 'peper'],
    rejectAny: ['doritos', 'chips', 'tortilla', 'nacho'],
  },
  {
    ingredient: 'almond flour',
    expectAny: ['amandelmeel', 'amandel', 'almond'],
    rejectAny: ['cake', 'taart', 'koek', 'croissant', 'reep'],
  },
  {
    ingredient: 'amandelmeel',
    expectAny: ['amandelmeel', 'amandel'],
    rejectAny: ['cake', 'taart', 'koek', 'croissant'],
  },
  {
    ingredient: "'nduja",
    expectAny: ['nduja', 'worst', 'salami'],
    rejectAny: ['eenpans', 'verspakket', 'maaltijd', 'kant-en-klaar'],
  },
  {
    ingredient: 'fresh lasagne sheets',
    expectAny: ['lasagne', 'lasagna', 'pasta'],
    rejectAny: ['glutenvrij', 'gluten-free', 'gluten free'],
  },
  {
    ingredient: 'basmati rice',
    expectAny: ['basmati', 'rijst', 'rice'],
    rejectAny: ['chips', 'cracker', 'snack', 'wafel'],
  },
]

interface CaseResult {
  ingredient: string
  expectAny: Array<string>
  matched: string | null
  score: number
  pass: boolean
}

async function main(): Promise<void> {
  const { decodeVector } = await import('#/lib/embeddings/codec')
  const { getCatalogue } = await import('#/lib/pricing/catalogue')
  const { storeProductId } = await import('#/lib/pricing/store-product-rows')
  const { selectCandidatesFromQueries, rerankMatch } =
    await import('#/lib/pricing/match-semantic')
  const { expandIngredientSearchTerms } =
    await import('#/lib/pricing/expand-ingredient')
  const { models } = await import('#/lib/models')
  const { EMBEDDING_DIMENSIONS, assertManifest } =
    await import('#/lib/embeddings/manifest')
  const { generateObject, embedMany, flush } =
    await import('#/lib/braintrust-ai')

  // Load + verify the committed index, then decode the AH vectors.
  const dir = join(process.cwd(), 'data', 'embeddings')
  const manifest = JSON.parse(
    readFileSync(join(dir, 'manifest.json'), 'utf8'),
  ) as Parameters<typeof assertManifest>[0]
  assertManifest(manifest)

  const rawVectors = JSON.parse(
    readFileSync(join(dir, 'products.json'), 'utf8'),
  ) as Array<{ id: string; store: string; v: string }>
  const entries: Array<ProductVectorEntry> = []
  for (const r of rawVectors) {
    if (r.store !== STORE) continue
    entries.push({ id: r.id, store: r.store, vector: decodeVector(r.v) })
  }

  // Build the id -> StoreProduct lookup the matcher needs, from the catalogue.
  const catalogue = getCatalogue(STORE)
  const lookup = new Map(
    (catalogue?.products ?? []).map((p) => [storeProductId(p), p]),
  )

  console.log(
    `Eval: ingredient -> SKU matcher (store ${STORE}, ${entries.length} vectors, ${CASES.length} cases, threshold ${THRESHOLD}).`,
  )

  const embeddingProviderOptions = {
    openai: { dimensions: EMBEDDING_DIMENSIONS },
  }

  // The reusable task: run the real pipeline for one ingredient, score it.
  async function runCase(c: Case): Promise<CaseResult> {
    const { terms } = await expandIngredientSearchTerms(c.ingredient, {
      model: models.rerank,
      generateObject,
    })
    const { embeddings: vectors } = await embedMany({
      model: models.embedding,
      values: [...terms],
      providerOptions: embeddingProviderOptions,
    })
    const candidates = selectCandidatesFromQueries(
      vectors,
      entries,
      lookup,
      TOP_K,
    )
    const { match } = await rerankMatch(
      { name: c.ingredient },
      candidates,
      STORE,
      {
        model: models.rerank,
        generateObject,
      },
    )
    const matched = match.product?.name ?? null
    const hay = (matched ?? '').toLowerCase()
    const expected =
      matched !== null && c.expectAny.some((k) => hay.includes(k))
    // A reject hit is a TYPE mismatch (Doritos for "chilli flakes"): hard fail,
    // even if an expectAny keyword also matched ("Doritos Sweet chilli").
    const rejected =
      matched !== null && (c.rejectAny ?? []).some((k) => hay.includes(k))
    const pass = expected && !rejected
    return {
      ingredient: c.ingredient,
      expectAny: c.expectAny,
      matched,
      score: match.score,
      pass,
    }
  }

  // The gate proper: run the cases, derive a pass rate, print a table. Every
  // embed/rerank call below is already traced to Braintrust via braintrust-ai.ts.
  const results: Array<CaseResult> = []
  for (const c of CASES) {
    try {
      results.push(await runCase(c))
    } catch (err) {
      results.push({
        ingredient: c.ingredient,
        expectAny: c.expectAny,
        matched: `ERROR: ${(err as Error).message}`,
        score: 0,
        pass: false,
      })
    }
  }

  try {
    await flush()
  } catch {
    // tracing flush is best effort; never let it affect the gate
  }

  printTable(results)

  const passed = results.filter((r) => r.pass).length
  const rate = passed / results.length
  console.log(
    `\nPass rate: ${passed}/${results.length} = ${(rate * 100).toFixed(0)}% (threshold ${(THRESHOLD * 100).toFixed(0)}%).`,
  )

  if (rate < THRESHOLD) {
    console.error('❌ matcher eval REGRESSION: pass rate below threshold.')
    process.exit(1)
  }
  console.log('✅ matcher eval passed.')
}

function printTable(results: Array<CaseResult>): void {
  console.log('')
  for (const r of results) {
    const flag = r.pass ? '✅' : '❌'
    const score = r.score ? ` (cos ${r.score.toFixed(3)})` : ''
    console.log(
      `${flag} ${r.ingredient.padEnd(14)} -> ${r.matched ?? '(no match)'}${score}`,
    )
  }
}

main().catch((err) => {
  console.error('eval crashed:', err)
  process.exit(1)
})
