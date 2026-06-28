# Matching architecture

How Souso matches things. Written so a fresh agent can pick up cold without
re-deriving the design from the code. Decisions behind it: ADR-0004 (OpenAI embeddings
for the three semantic matchers, vectors in D1), ADR-0003 (one D1, no libSQL, no separate
vector store), ADR-0002 (benchmark gate), ADR-0001 (the original Vectorize path, kept for
history).

## There are different matching jobs

They look similar ("match X to Y") but they are different problems, and they split two
ways:

- **Preference (recommendation)** is still set-maths. The benchmarked adaptive
  recommender ranks recipes for a household and vectors never touch it (ADR-0002 gates it).
- **The three semantic matchers** (dish similarity, ingredient-to-product pricing, replan
  term-match) now use **OpenAI embeddings + cosine** over vectors committed to the repo and
  loaded into D1, with **LLM rerank only for ambiguous ingredient-to-product cart
  matches**.
  This replaced the earlier set-maths versions (token overlap, Jaccard, substring) because
  those gave no cross-language recall: "mushroom" never matched Dutch "champignon" (ADR-0004).

The data layer is still a single D1 with no Vectorize/libSQL/Turso. The vectors live IN
that D1 (see "Where the data lives").

### 1. Profile to recipe (preference / recommendation)

- **What:** rank the catalogue for a household from swipes + the learned profile. Drives
  recipe choice in the planner.
- **Where:** `src/lib/recsys/` (strategies, Bayesian adaptive recommender, feedback-fold,
  explain-why). Benchmarked; gated on recall by ADR-0002.
- **Mechanism: set-maths.** The adaptive recommender won the benchmark; the overnight run
  showed uniform sampling beats vector "diversity" for onboarding, so vectors never
  touched this path.
- **Data:** household `profile` JSON + recipe rows in D1.

### 2. Dish to dish (similarity / "swap this meal")

- **What:** given a recipe, find valid substitutions ("more like this", "faster",
  "lighter"), respecting the household's allergy/diet hard filters.
- **Where:** `src/lib/vectors/` (`similar.ts` orchestration, `similar-score.ts` scorer).
- **Mechanism: embeddings + cosine.** The scorer ranks recipes by `cosineSimilarity`
  (AI SDK) against precomputed recipe vectors, loaded once per isolate into a module-global
  cache. This **replaced** the earlier Jaccard token-overlap scorer, which scored zero
  whenever two dishes shared no literal token (a cross-language miss the embedding closes).
- **Pure core:** `postProcessNeighbours` in `similar.ts` (drop self, hard-filter, re-rank,
  truncate) is storage-agnostic and unit-tested without any backend. Unchanged: only the
  scorer underneath swapped.
- **Keyless:** works with **no `OPENAI_API_KEY`**, because the recipe vectors are
  precomputed and committed; nothing is embedded live on this path.

### 3. Ingredient to product (pricing / cart)

- **What:** match a recipe's ingredient ("200g spaghetti") to a real supermarket product
  so we can price the basket per store and fill the AH cart.
- **Where:** `src/lib/pricing/` (`normalise.ts`, `match.ts`, `catalogue.ts`,
  `price-list.ts`).
- **Mechanism: embeddings + cosine retrieval, rerank only when needed.** The
  ingredient text is embedded and scored by cosine against committed product vectors.
  - **Cart and price paths:** a very strong, clearly separated cosine winner is accepted
    directly. Ambiguous top-K candidates go through a `generateObject` rerank, which
    picks the right SKU or declines. Price comparison uses the same path through
    `match_cache` so repeated store/name (+ amount when present) resolutions do
    not keep paying the model cost. A cached negative for one amount must not
    block another — keys include the normalised amount when the line carries one.
  - **No weak cosine-only product truth:** ordinary/high-ish embedding neighbours are
    candidates, not final matches; they must clear the stricter fast-path threshold or
    go to rerank.
  - A **confidence flag on every match** so estimated lines never silently inflate the
    "save money" claim. Grounded and explainable, as the hard rules require.
- **Mechanism replaced:** the earlier token / fuzzy-string matcher in `match.ts`, which
  could not match across languages ("minced beef" vs "rundergehakt").
- **Keyless:** **requires `OPENAI_API_KEY`** at runtime, because it embeds the live
  ingredient text. With no key it returns `confidence: 'none'` and an honest UI note. There
  is no silent fallback to the old token matcher.
- **Data:** the vendored checkjebon snapshot (`src/lib/pricing/data/supermarkets.json`),
  bundled at build time, never live-fetched on the request path. Provenance + licence
  caveat in `src/lib/pricing/data/NOTICE.md`. Product vectors live on `store_product` in D1
  (see "Where the data lives").

### 4. Replan term-match (exclude / more-of)

- **What:** a plain-language replan term ("no mushrooms", "more pasta") has to find the
  recipes it refers to, so the planner can exclude or favour them.
- **Where:** the replan path (was substring `recipeMatchesTerm` plus the term-synonyms
  maps from PR #187).
- **Mechanism: embeddings + cosine.** The term is embedded and scored by cosine against
  recipe vectors. The hand-maintained synonyms maps are gone: the embedding gives the
  synonymy ("champignon" / "paddenstoel" for "mushroom") for free.
- **Keyless:** **requires `OPENAI_API_KEY`** at runtime, because it embeds the live term.
  With no key it declines with the existing "AI adjustments off" message. No silent fallback
  to the old substring matcher.

## Where the data lives

**One D1 database. No separate vector DB, no libSQL/Turso, no second database** (ADR-0003,
ADR-0004). It is still one D1; the vectors now live IN it.

- `recipe`, `household`, `meal_plan`, etc.: D1 tables (`src/db/schema.ts`).
- checkjebon catalogue: committed JSON, bundled into the Worker.
- **Embeddings live in D1**, encoded Float32 to base64: an `embedding` blob column on
  `store_product` (product vectors) and a `recipe_embedding` table (recipe vectors). The
  vectors are committed to `data/embeddings/*` (the same pattern as the committed
  supermarkets snapshot) and loaded into D1 by `scripts/seed.ts`, so a fresh clone plus a
  CI run reproduces every matcher with zero API calls.
- At request time the vectors load from D1 into a per-isolate module-global cache and are
  scored brute-force with `cosineSimilarity` (AI SDK). At ~5k products + ~1.5k recipes a
  linear scan is fast, so there is no ANN index, no Vectorize, no Turso (ADR-0004).
- Preference ranking stores no vectors and computes from rows; only the three semantic
  matchers use embeddings.

The only thing that genuinely goes stale is the checkjebon price snapshot. For now it is a
committed snapshot; the longer-term shape is a periodic sync job (cron Worker re-seeds it),
not a different database engine.

## Cart correctness gates (#363)

Three invariants lock cart → Albert Heijn correctness in `pnpm quality`:

1. **Ingredients ↔ recipes** — `src/lib/shopping/consolidate.test.ts`
2. **Grams + pack counts** — `consolidate.test.ts` + `src/lib/pricing/basket.test.ts`
3. **AH URL faithfulness** — `src/lib/cart-build.test.ts`

`src/lib/cart-invariants.test.ts` wires (1)+(2)+(3) through the week → consolidate →
`packsForAmount` → URL path. Wrong-type matches (chilli flakes ≠ Doritos, etc.) are
gated by `pnpm eval` golden cases with `rejectAny` filters in `scripts/eval.ts`.

## Note on offline analysis

The runtime ingredient-to-product matcher lives in `src/lib/pricing/`. Any Python notebook
that re-ports the same checkjebon logic (e.g. for offline pricing analysis over the full
recipe set) is a **validator**, not a second runtime matcher: if the two disagree on an
ingredient, the TS path in `src/lib/pricing/` is the source of truth.
