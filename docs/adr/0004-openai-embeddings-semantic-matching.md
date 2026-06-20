# ADR-0004: OpenAI embeddings for the three semantic matchers, vectors in D1

- **Status**: accepted
- **Date**: 2026-06-20
- **Supersedes**: ADR-0003 (for the three semantic matchers)

## Context

ADR-0003 settled that all matching was set-maths, so there was nothing to put in a
vector store. That call was right about scale and right to reject ANN infrastructure
(Vectorize, Pinecone, libSQL's index): the catalogue is ~5k products and ~1.5k
recipes, which is far too small for approximate-nearest-neighbour to earn its keep.

What changed is the quality floor. Token overlap and substring matching cannot give
semantic recall across languages, and the catalogue is Dutch-first. "mushroom" has to
match "champignon" and "paddenstoel"; "minced beef" has to match "rundergehakt". A
Jaccard or substring matcher sees no shared token and scores zero. That is the "slop"
the team kept hitting in similar-swap, replan term-matching, and ingredient-to-product
pricing. ADR-0003 named this exact escape hatch: swap `similar-score.ts` to a vector
index behind if semantic recall ever matters more than setup simplicity. It now
matters, so we are exercising that hatch, but in D1, not in Vectorize.

The reasoning that ANN is overkill still holds. We want embeddings for recall, not an
ANN index for scale. Those are separable: you can store vectors and score them
brute-force.

## Decision

Add semantic matching via embeddings for **three matchers only**, and keep the vectors
**in the one D1 database**.

**Model.** OpenAI `text-embedding-3-small` at `dimensions: 256`. It is multilingual
(NL/EN, which the Dutch catalogue needs) and small enough to store cheaply. It is wired
through `@ai-sdk/openai` as `models.embedding` in `src/lib/models.ts`, next to the
existing chat models.

**Storage, in D1, not a separate store.** Each vector is encoded Float32 to base64.
A new `embedding` blob column on the existing `store_product` table holds product
vectors; a new `recipe_embedding` table holds recipe vectors. The vectors are committed
to `data/embeddings/*` (the same pattern as the committed `supermarkets.json` snapshot)
and loaded into D1 by `scripts/seed.ts`. A fresh clone plus a CI run reproduces the
full matcher with zero API calls, because the vectors are already in the repo.

**Retrieval, brute-force cosine in memory.** On first use per isolate, the vectors load
from D1 into a module-global cache. Scoring is `cosineSimilarity` from the AI SDK over
the cached arrays. At ~5k + ~1.5k vectors this is a fast linear scan, so no ANN index,
no Vectorize, no Turso. This is the direct answer to ADR-0003: it was right that ANN was
overkill, and brute-force cosine keeps it overkill while still giving semantic recall.

**LLM rerank, only at decision points.** The ingredient-to-SKU cart path is the one
place a wrong pick costs the user: it does cosine top-K, then a `generateObject` rerank
(`models.fast`) to choose the right product and sanity-check quantity plausibility.
Price totals and staples search use cheap cosine top-1 with **no LLM**: a week's list is
~60 lines, and a per-line LLM call is too slow and too costly for that path.

**The three matchers being changed:**

1. **Ingredient to product / SKU pricing** (was token-overlap in
   `src/lib/pricing/match.ts`): now cosine over committed product vectors, with the
   `generateObject` rerank on the cart path and cosine top-1 for price totals and
   staples.
2. **Dish to dish similarity** (was Jaccard in `src/lib/vectors/similar-score.ts`): now
   cosine over committed recipe vectors. The pure `postProcessNeighbours` core in
   `similar.ts` (drop self, hard-filter on allergy/diet, re-rank, truncate) is unchanged;
   only the scorer underneath swapped.
3. **Replan term-match for exclude / more-of** (was substring `recipeMatchesTerm` plus
   the term-synonyms maps from PR #187): now embeds the user's term and scores it by
   cosine against recipe vectors. The hand-maintained synonyms maps go away; the
   embedding gives the synonymy for free.

**Unchanged and still deterministic.** The recsys preference recommender
(`src/lib/recsys/`, profile-to-recipe ranking) stays set-maths. Vectors never touch
preference ranking. The ADR-0002 frozen-fixture recall gate stays intact and keeps
gating that path. Also unchanged: hard allergy/diet filters, planner week generation,
shopping consolidation, and cart URL building.

## Consequences

- The single-D1 stance from ADR-0003 still holds: one engine, no Turso, no Vectorize,
  no second database. The only change is that D1 now carries vectors (a base64 Float32
  blob on `store_product` plus a `recipe_embedding` table). Local and live still run the
  same engine, and a fresh clone still seeds from committed data with no Cloudflare
  account.
- Zero API calls to build or test the matchers: vectors are committed to
  `data/embeddings/*` and seeded into D1, so CI and a cold clone are deterministic and
  offline. Re-embedding is a deliberate act (regenerate the committed vectors), not
  something that happens on the request path.
- `dimensions: 256` is now load-bearing for the stored vectors. Changing the model or
  the dimension count means re-embedding the whole catalogue and rewriting the committed
  files. Acceptable for a fixed seed catalogue; revisit only if the catalogue grows or a
  better small multilingual model appears.
- Brute-force cosine is O(catalogue) per query. Fine at ~5k + ~1.5k vectors, held in a
  per-isolate module cache so the scan runs over in-memory arrays. If the catalogue ever
  grows past the low tens of thousands and the scan stops being instant, the escape hatch
  is the same one ADR-0003 named: put a real index behind the scorer. Not needed now.
- LLM cost is contained by design: `generateObject` rerank fires only on the
  ingredient-to-SKU cart path (the one decision point where a wrong pick is expensive),
  never per price line. Price totals and staples stay pure cosine.

### Keyless degradation contract

This is a deliberate, accepted tradeoff. Two matchers embed **live user text** at
runtime and so need a key; the rest run off precomputed vectors or set-maths and do not.

- **Works with no `OPENAI_API_KEY`:** similar-swap (scores against precomputed recipe
  vectors, no live embed), planning, and week generation (set-maths over rows). These
  keep working on a fresh clone with no key.
- **Requires `OPENAI_API_KEY` at runtime:** replan term-matching and cart / price
  matching, because both embed text the user just typed. They degrade honestly rather
  than silently:
  - Replan declines with the existing "AI adjustments off" message.
  - Price / cart matching returns `confidence: 'none'` with an honest UI note.
- **There is no hidden fallback to the old token matcher.** Falling back would
  reintroduce the cross-language slop this ADR removes, so a missing key fails loud and
  honest, it does not quietly serve worse matches.
