# ADR-0003: One D1 database, no libSQL/Turso, no vector store

- **Status**: superseded by ADR-0004 (for semantic matching; the single-D1 / no-Turso / no-Vectorize stance still holds, vectors now live IN D1)
- **Date**: 2026-06-20
- **Supersedes**: ADR-0001 (Vectorize for recipe similarity)

> **Partly superseded by [ADR-0004](./0004-openai-embeddings-semantic-matching.md).** The
> three semantic matchers (ingredient-to-product pricing, dish-to-dish similarity, replan
> term-match) now use OpenAI embeddings + cosine, exercising the escape hatch this ADR
> named. What still holds: one D1, no Turso, no separate vector store. The vectors now
> live IN D1 (a base64 Float32 blob on `store_product` plus a `recipe_embedding` table),
> not in a second engine. The body below is kept as the record of why there is no separate
> vector store and no Turso.

## Context

A recurring question: should the catalogue + any embeddings live in a separate vector
store (Cloudflare Vectorize, originally) or a separate database engine (libSQL/Turso was
proposed so the same DB runs locally and live)? The trigger was the friction of
replicating "D1 + a vector index" locally, plus a preference for shipping committed data
so dev and prod load the same thing.

Three facts settle it:

1. **The build runs on a small curated catalogue.** At this size, exact set-maths
   (token overlap, simple ranking) is instant. Approximate-nearest-neighbour
   infrastructure (Vectorize, Pinecone, libSQL's ANN index) solves a scale problem we do
   not have.

2. **libSQL/Turso does not run inside a Cloudflare Worker.** No filesystem, no
   persistent process, no `sqld`, and libSQL's embedded-replica model (the thing that
   makes it pleasant locally) does not work in a Worker. "Live" would mean Turso over
   HTTP: a second vendor and a network hop on every query. That trades our
   Cloudflare-native D1 for an external dependency and wins nothing at this scale.

3. **All matching ended up as set-maths, so there is nothing to put in a vector store**
   (see `docs/matching.md`). Profile-to-recipe preference is the benchmarked adaptive
   recommender (`src/lib/recsys/`); dish-to-dish similarity is token overlap
   (`src/lib/vectors/similar-score.ts`); ingredient-to-product pricing is fuzzy string
   matching over a committed checkjebon snapshot (`src/lib/pricing/`). None use vectors.

## Decision

**One D1 database holds everything. No libSQL, no Turso, no separate vector DB.** Recipes,
the checkjebon product snapshot (vendored/bundled), and all derived data live in D1 or as
committed build-time assets, so local and live are the same engine and a fresh clone runs
with no Cloudflare account.

The original Vectorize + Workers AI embeddings path (ADR-0001) was **removed**, not
deferred: dish similarity is now `rankBySimilarity` in `similar-score.ts` (Jaccard over
the same `recipeText` the embeddings used, plus a same-cuisine boost). The pure
post-processing in `similar.ts` (`postProcessNeighbours`: drop self, hard-filter on
allergy/diet, re-rank, truncate) is unchanged; only the scorer underneath swapped from a
vector query to set-maths.

## Consequences

- Local and live run the same engine (D1) for every matching job, with no Vectorize
  emulation gap and no external Turso account. `npm run init` + committed seed is the
  whole setup.
- Quality trade-off, recorded deliberately: token overlap is less "semantic" than a
  multilingual embedding. It is deterministic, instant at this catalogue size, and good
  enough for "swap this meal" (shared ingredients + same cuisine dominate). `similar-score.ts`
  is the single function to swap back to a vector index behind if semantic recall ever
  matters more than setup simplicity.
- D1 cannot load SQLite extensions (`sqlite-vec` is unavailable), so an in-SQL vector
  function was never an option anyway; noted so no one reaches for it and finds it blocked.
- Escape hatch if the catalogue grows past the low tens of thousands and set-maths recall
  stops being enough: reintroduce a vector index behind `similar-score.ts`, either
  Cloudflare Vectorize (still CF-native, ADR-0001 wired it once) or libSQL/Turso for its
  native index (accepting the external hop). Neither is needed now.
- The `RECIPES_VECTORS` and `AI` bindings have been removed from `wrangler.jsonc` (nothing
  in `src` references them), so the deployed Worker carries no vector/AI binding.
- `decisions.md` item 5 ("Neon Postgres") was stale: the running code is D1/SQLite. It has
  been annotated rather than rewritten, and locked item 15 records the actual DB.
