# Matching architecture

How Souso matches things. Written so a fresh agent can pick up cold without
re-deriving the design from the code. Decisions behind it: ADR-0003 (one D1, no
libSQL, no vector store), ADR-0002 (benchmark gate), ADR-0001 (the now-removed
Vectorize path, kept for history).

## There are three different matching jobs

They look similar ("match X to Y") but they are different problems. The key fact: **none
of them use vectors or a vector store.** All three are set-maths, which is why the data
layer is a single D1 with no Vectorize/libSQL/Turso.

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
- **Mechanism: set-maths token overlap.** `rankBySimilarity` is Jaccard over the
  `recipeText` (title + cuisine + ingredients) plus a same-cuisine boost. This **replaced**
  the original Cloudflare Vectorize + Workers AI embeddings path (ADR-0001) so the app
  needs no vector index, no embed job, and no Cloudflare account in local dev.
- **Pure core:** `postProcessNeighbours` in `similar.ts` (drop self, hard-filter, re-rank,
  truncate) is storage-agnostic and unit-tested without any backend.
- **Quality note:** token overlap is less "semantic" than an embedding but deterministic,
  instant at this scale, and good enough (shared ingredients + same cuisine dominate).
  `similar-score.ts` is the one function to swap back to a vector index behind if semantic
  recall ever matters more than setup simplicity (ADR-0003).

### 3. Ingredient to product (pricing)

- **What:** match a recipe's ingredient ("200g spaghetti") to a real supermarket product
  so we can price the basket per store and fill the AH cart.
- **Where:** `src/lib/pricing/` (`normalise.ts`, `match.ts`, `catalogue.ts`,
  `price-list.ts`).
- **Mechanism: fuzzy string / token matching, no vectors.** `scoreMatch` +
  `confidenceFromScore` over a normalised name index, with a **confidence flag on every
  match** so estimated lines never silently inflate the "save money" claim. Grounded and
  explainable, as the hard rules require.
- **Data:** the vendored checkjebon snapshot (`src/lib/pricing/data/supermarkets.json`),
  bundled at build time, never live-fetched on the request path. Provenance + licence
  caveat in `src/lib/pricing/data/NOTICE.md`.

## Where the data lives

**One D1 database. No separate vector DB, no libSQL/Turso, no second database** (ADR-0003).

- `recipe`, `household`, `meal_plan`, etc.: D1 tables (`src/db/schema.ts`).
- checkjebon catalogue: committed JSON, bundled into the Worker.
- No embeddings are stored anywhere; all three matchers compute from the rows/snapshot.

The only thing that genuinely goes stale is the checkjebon price snapshot. For now it is a
committed snapshot; the longer-term shape is a periodic sync job (cron Worker re-seeds it),
not a different database engine.

## Note on offline analysis

The runtime ingredient-to-product matcher lives in `src/lib/pricing/`. Any Python notebook
that re-ports the same checkjebon logic (e.g. for offline pricing analysis over the full
recipe set) is a **validator**, not a second runtime matcher: if the two disagree on an
ingredient, the TS path in `src/lib/pricing/` is the source of truth.
