# Plan: embedding-based ingredient → SKU matching

Status: proposal for Nicolas. No PR opened (this is yours to build if you want it).
Grounded against the current `main` so the file paths are real.

## The reframe

There are two separate problems and only one of them is new:

1. **Recipe → recipe similarity** ("more like this", exclude/more-of). Already done:
   Cloudflare Vectorize index `smart-cart-recipes`, bge-m3, 1024-dim, multilingual.
   See `src/lib/vectors/index.ts` and ADR-0001.
2. **Ingredient → product (SKU) matching across languages.** This is the new bit.
   "mushroom" must land on `champignon` / `paddenstoel` products without a synonym dict.

So the build is mostly: stand up a **second Vectorize index for products**, reusing the
exact infra we already have for recipes. We are not inventing anything, we are pointing
the same embed/query code at checkjebon product names.

## What we actually have today (so we kill the right things)

- `src/lib/pricing/match.ts` — token-overlap scorer, confidence bands, floor 0.3, pure/no-IO.
  This is the matcher to replace. (There is **no** `term-synonyms.ts`; the only "heuristic"
  is stop-word + unit-token lists in this file.)
- `src/lib/replan/apply.ts` → `recipeMatchesTerm()` — substring matching of a free term
  against recipe text for exclude/more-of. This is the other heuristic.
- `src/lib/replan/parse.ts` — deterministic regex intent parser, with an LLM fallback in
  `src/lib/replan/fallback.ts`. Nicolas wants this to always go LLM.
- `src/lib/vectors/index.ts` — `embed()`, `upsertRecipes()`, `similar()`, `similarToText()`.
  Workers AI `@cf/baai/bge-m3`. **Reuse this.**
- `src/lib/pricing/catalogue.ts` — parses the checkjebon snapshot into normalised
  `StoreProduct` (store, name, normalisedName, priceCents, slug, size).
- `src/lib/models.ts` — Vercel AI SDK, OpenAI `gpt-5` active (`models.fast` for cheap calls).
- DB is **Cloudflare D1 (SQLite)**, vectors in **Vectorize** (not Neon/pgvector, despite
  decisions.md #5 which is stale). `recipe.ingredients` is a JSON array
  `[{name, qty?, unit?, productId?}]` — note `productId` already exists and is unused.

## Architecture

### The key move: pre-resolve offline, LLM only for novel asks

Nicolas's plan runs embed + LLM rerank per ingredient at request time. That is the right
pipeline but in the wrong place for the demo. Per-ingredient embed + per-ingredient LLM
call across ~15 ingredients is slow, costly, and non-deterministic (the basket changes
between runs). It also fights the "must be reproducible" rule.

Better: run the retrieve+rerank pipeline **offline at seed time** and write the winning
SKU into `recipe.ingredients[].productId` (the field is already there). Then:

- **Planned-week basket** is instant, deterministic, free at request time: just read the
  resolved `productId`. The demo basket never changes between takes.
- **Live LLM path** is only for genuinely novel asks: "add something with mushrooms",
  "00 flour instead of tarwebloem". That is where embeddings + LLM earn their keep, and
  it is a handful of calls, not 15.

This gives Nicolas exactly the system he described, and it makes the demo reproducible
and fast.

### Components

**1. Product vector index (offline)**

- New Vectorize index `smart-cart-products`, binding `PRODUCTS_VECTORS` in `wrangler.jsonc`
  (mirror the existing `RECIPES_VECTORS` block).
- `scripts/embed-products.ts` (copy `scripts/embed-recipes.ts`): read normalised products
  from `catalogue.ts`, embed each product name with bge-m3, upsert with metadata
  `{ store, name, priceCents, slug }`. Vector id = `${store}:${slug}`.
- bge-m3 is multilingual, so "mushroom" ≈ "champignon" ≈ "paddenstoel" falls out for free.
  This is what replaces the synonym idea entirely.

**2. Retrieve + rerank matcher (`src/lib/pricing/match-embed.ts`)**

- `embed(ingredientName)` → `PRODUCTS_VECTORS.query(vec, { topK: 10, filter: { store } })`.
- LLM rerank: pass the ingredient (`name`, `qty`, `unit`) + the 10 candidates to
  `generateObject` (`models.fast`) with a Zod schema returning
  `{ slug, confidence: 'high'|'medium'|'low', packNote }`. The LLM does the
  "actually makes sense" + quantity reasoning Nicolas described (e.g. don't pick a 5kg
  catering bag for "2 cloves garlic").
- Return the existing `IngredientMatch` shape so it is a drop-in. Keep `estimated`/
  confidence semantics (never present a soft match as a real shelf price).
- Graceful fallback to top-1 embedding hit when `OPENAI_API_KEY` is absent (same pattern
  as `src/lib/replan-server.ts`).

**3. Offline resolver (`scripts/resolve-skus.ts`)**

- For every AH recipe, run component 2 over each ingredient, write `productId` back into
  the seed JSON / D1. One-time + re-runnable. This is what makes the basket deterministic.

**4. Substitution + replan (live LLM)**

- "00 flour instead of tarwebloem" and "add mushrooms" both reduce to: embed the phrase →
  query `PRODUCTS_VECTORS` (or `smart-cart-recipes` for recipe-level asks) → LLM confirm.
  Same pipeline as component 2, different entry point. This is where `parse.ts` gets
  dropped in favour of always-LLM intent parsing feeding the same structured edit shape.

## Keep deterministic (do not touch)

Per ADR-0001 and the reproducibility rule:

- Week generation ranking (`src/lib/planner/`, `src/lib/recsys/`).
- Hard allergy / diet filters.
- Shopping list consolidation (`src/lib/shopping/consolidate.ts`).
- Cart URL building from resolved SKUs.

## Gotchas (the ones that will actually bite)

1. **The committed checkjebon snapshot is trimmed to ~400 products/store.** Real matching
   needs coverage. Run `pnpm tsx scripts/sync-checkjebon.ts --full` (107k products) before
   embedding, or half the ingredients will miss. This is the single biggest risk to a good demo.
2. **Latency/cost at request time** if you do per-ingredient LLM calls. The offline
   pre-resolve above avoids it for the planned week; for live asks, batch one embed call +
   parallel queries + a single rerank call over the whole list.
3. **Reproducibility.** The rerank is non-deterministic. Pinning resolved SKUs onto the
   recipe (component 3) is what keeps the demo basket stable take-to-take.
4. **Vectorize is eventually consistent on upsert.** Embed products well before the demo,
   not minutes before.

## Decision record

This is not a revert of "no vectors" — ADR-0001 already allows vectors for recipe
similarity. Add `docs/adr/0003-embedding-product-match.md` extending it to a second
allowed use: ingredient/product matching where multilingual semantics genuinely matter.
Leave deterministic ranking/filters out of scope, same as 0001.

## Suggested build order

1. `sync-checkjebon --full` + `scripts/embed-products.ts` + the `PRODUCTS_VECTORS` binding.
2. `src/lib/pricing/match-embed.ts` (retrieve + rerank), with the no-key fallback.
3. `scripts/resolve-skus.ts` → populate `productId` for AH recipes (deterministic basket).
4. Live substitution path ("mushrooms", "00 flour") through the same pipeline.
5. ADR-0003 + a couple of fixture tests (mushroom→champignon, tarwebloem→00 flour).
