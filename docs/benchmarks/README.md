# Swipe onboarding: how we pick recipes

The onboarding is an active-learning problem: show the fewest recipe cards needed
to learn a household's taste well enough to rank the catalogue the way they would.
We benchmarked several strategies against synthetic users with known tastes.

## Setup (reproducible)

```bash
pnpm tsx scripts/fetch-recipes.ts        # 666 real recipes (TheMealDB), 37 cuisines
pnpm tsx scripts/gen-synthetic-users.ts  # 300 synthetic users with known tastes
pnpm tsx scripts/benchmark.ts            # runs every strategy, writes results.md
```

Each synthetic user has hidden loved/disliked cuisines, loved/disliked ingredients,
and maybe a vegetarian constraint (`scripts/gen-synthetic-users.ts`). The hidden
truth (`src/lib/recsys/ground-truth.ts`) decides their swipes and their true top-20.
The recommender only sees the like/dislike swipes.

## Strategies (`src/lib/recsys/strategies.ts`)

- **random** — uniform deck, rank by liked-cuisine frequency. A strong baseline.
- **maths** — IDF-weighted attribute model.
- **vector** — TF-IDF embedding, diverse deck, centroid ranking.
- **hybrid** — vector + maths blend.
- **adaptive** — the winner. Uniform sampling (the unbiased read on each cuisine)
  with a diverse first round, ranked by cuisine net-preference plus a
  CONFIDENT-only ingredient adjustment (an ingredient counts only when it is
  distinctive, not common like salt/onion, and has clear one-sided evidence).

## What we learned

See `results.md` for the live table. The headline findings:

1. **Cuisine is the dominant, learnable signal.** Ingredient preferences are real
   but hard to learn from sparse swipes; using them naively HURTS, because common
   tokens (sugar, onion, even chicken) get mistaken for signal. IDF-gating fixed it.
2. **Clever diversity decks BIAS per-cuisine estimates** (one sample of a cuisine
   can't tell "love the cuisine" from "liked one dish"). Plain uniform sampling is
   unbiased and surprisingly strong.
3. **adaptive converges about twice as fast** as uniform random: it reaches a good
   match (60% recall of the true top-20) in a median of ~10 swipes vs ~20, and
   leads at every checkpoint through 25 swipes. That fast convergence is the whole
   point of the onboarding, so adaptive is the production recommender.

The same `explain()` that powers the ranking also produces the profile badges and
the admin "what we think they like" view, so the data points are reused everywhere.
