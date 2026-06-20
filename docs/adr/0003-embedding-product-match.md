# ADR-0003: Embedding + LLM rerank for ingredient -> product (SKU) matching

- **Status**: accepted
- **Date**: 2026-06-20

## Context

Turning a free-text recipe ingredient ("champignons", "2 teen knoflook",
"mushroom") into the right store product is the hard part of the basket, not the
price lookup (see the #45 research). The first matcher (`src/lib/pricing/match.ts`)
scores token overlap between the ingredient name and the product name. That is a
heuristic with a built-in ceiling: it cannot bridge languages or synonyms. The
ingredients are often Dutch and a user may ask in English, so "mushroom" never
overlaps "champignon" / "paddenstoel". The obvious patch (a synonym table) is the
same mistake one level up: hand-maintained, brittle, and endless.

ADR-0001 already runs Cloudflare Vectorize + Workers AI bge-m3 for recipe
similarity, and explicitly fences vectors to "dish-to-dish similarity, the one
place they genuinely help". Ingredient -> product matching is a second place they
genuinely help, for the same reason: bge-m3 is multilingual, so semantic nearness
crosses the NL/EN gap with no synonym table.

## Decision

Add a second Vectorize index, `smart-cart-products` (cosine, 1024 dims, bge-m3),
and match in two stages:

1. **Retrieve**: embed the ingredient name, query the product index filtered by
   store, take the top-K nearest products. (`src/lib/pricing/product-vectors.ts`)
2. **Rerank**: an LLM picks, from those candidates only, the product a shopper
   would actually buy for this ingredient and quantity (a normal pack size, not a
   catering bag for "2 cloves"). It returns a candidate index or declines; it
   never invents a product. (`src/lib/pricing/match-embed.ts`)

This carves out an exception to ADR-0001's "vectors only for similarity" fence:
vectors now also do ingredient/product matching. Everything that must be
reproducible stays deterministic and untouched: week-generation ranking
(recsys), hard allergy/diet filters, shopping-list consolidation, and cart-URL
building. The recommender benchmark (ADR-0002) is unaffected; it measures recipe
ranking, not SKU resolution.

The embed text is shared between the offline job and the Worker via
`src/lib/pricing/product-text.ts`, exactly as ADR-0001 shares recipe text. The
matcher returns the same `IngredientMatch` shape as `match.ts`, so it is a
drop-in: low/medium confidence stays `estimated`, a no-match never invents a
price.

### Reproducibility (the demo-critical bit)

The rerank is non-deterministic. To keep a planned week's basket stable and fast,
the intended pattern is to run retrieve+rerank OFFLINE and write the winning SKU
into `recipe.ingredients[].productId` (the field already exists, unused). The live
LLM path is then reserved for genuinely novel asks: "add something with
mushrooms", "00 flour instead of tarwebloem". (Offline resolver not built in this
foundation PR; the pieces it needs are.)

## Consequences

- Multilingual matching with no synonym table; "mushroom" finds "champignons".
- Offline-shippable: with no `OPENAI_API_KEY` the matcher degrades to the top
  vector hit (no quantity reasoning), and any model error degrades the same way.
  A flaky model never breaks a basket build.
- Two load-bearing one-time setup steps before it works:
  - `wrangler vectorize create smart-cart-products --dimensions=1024 --metric=cosine`
  - `wrangler vectorize create-metadata-index smart-cart-products --property-name=store --type=string`
    (the query filters by store, so `store` must be an indexed metadata field).
- The committed checkjebon snapshot is trimmed to ~400 products/store. Real
  coverage needs `pnpm tsx scripts/sync-checkjebon.ts --full` (107k products)
  before `pnpm embed:products`, or many ingredients have no candidate.
- bge-m3 1024 dims is load-bearing here too: changing the model means re-embedding
  the product index.
- `match.ts` (the token matcher) stays for now as the no-vector fallback and the
  staples search path; it can be retired once the embedding path is wired into the
  pricing flow and proven against the frozen fixture.
