# ADR-0001: Cloudflare Vectorize + Workers AI for recipe similarity

- **Status**: accepted
- **Date**: 2026-06-19

## Context

We want "more like this" and similar-meal swaps over the recipe catalogue. The
question during the grill: where do the embeddings live and which model produces
them? This is hard to reverse because the embedding model fixes the vector
dimensions, and changing it means re-embedding the whole catalogue and rebuilding
the index. Preference inference stays set-maths (the benchmarked adaptive
recommender); vectors are only for dish-to-dish similarity, which is the one place
they genuinely help.

The grill also settled a related tension: the overnight benchmark showed uniform
sampling beats vector "diversity" decks for onboarding, so vectors do **not** touch
the swipe deck. They power similarity and meal-swap only.

## Decision

Use **Cloudflare Vectorize** (index `smart-cart-recipes`, cosine, 1024 dims) with
**Workers AI `@cf/baai/bge-m3`** for embeddings. Embeddings are built offline by a
script (`scripts/embed-recipes.ts`) from `title + cuisine + ingredients` and upserted
once; the app only ever queries the index, never re-embeds at request time.

## Consequences

- Fully CF-native: no external vector vendor, no extra API key (Workers AI is account-bound). Fits the "use all of CF" steer.
- bge-m3 is multilingual, so Dutch recipe text (AH/Jumbo) embeds without a translation step.
- 1024 dims is now load-bearing: switching embedding model requires a new index and a full re-embed. Acceptable for a fixed seed catalogue; revisit if the catalogue grows to ~40k and refresh cost matters.
- Similarity is read-only over a fixed embedding. Live catalogue inserts will need an embed-on-insert path later (not built now).
- Requires a CF token with `Vectorize:Edit` + `Workers AI:Edit` to create the index and run the embed script (use `CLOUDFLARE_ACCOUNT_TOKEN_RONAN`, the full-access personal token, not the deploy-only `_RONAN` Workers token).
