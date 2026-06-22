# How Souso's AI actually works

The matching system, the tools, the vectors, and the evals. Written for a human
who wants to understand the design, not re-derive it from the code.

## The starting point: naming the slop

The first cut of the AI features was the obvious one. Match an ingredient to a
product by comparing strings. Find a similar dish by counting shared words. Read
a replan request ("no mushrooms") and look for the substring. It demos fine in
English and falls apart the moment the catalogue is Dutch.

"mushroom" shares no letters with "champignon". "minced beef" shares nothing
with "rundergehakt". A token-overlap or substring matcher sees no common token
and scores zero, so it returns nothing or returns junk. That was the recurring
failure across similar-swap, replan term-matching, and ingredient-to-product
pricing. The fix was not a better string trick. It was to step back and ask what
each matching job actually is, then pick the right tool for each one.

That rethink is recorded in the ADRs (`docs/adr/`), benchmarked where it counts,
and locked by evals so it cannot quietly regress. The rest of this doc is what
came out of it.

## Matching is several different problems, not one

They all read as "match X to Y", but they split two ways.

**Preference (recommendation) stays set-maths.** Ranking the catalogue for a
household from swipes plus the learned profile is a recommendation problem, and a
benchmarked adaptive recommender wins it. An overnight benchmark run showed
uniform sampling beats vector "diversity" for onboarding, so vectors never touch
this path. It lives in `src/lib/recsys/` and is gated on recall (more on the gate
below).

**The three semantic matchers use embeddings.** Dish-to-dish similarity,
ingredient-to-product pricing, and replan term-matching all need cross-language
recall, so they use OpenAI embeddings plus cosine over vectors, with an LLM
rerank at exactly one decision point. This is the part that replaced the slop.

### The three semantic matchers

1. **Dish to dish ("swap this meal").** Given a recipe, find valid
   substitutions that respect the household's allergy and diet hard filters.
   Code: `src/lib/vectors/` (`similar.ts` orchestration, `similar-score.ts`
   scorer). It ranks recipes by cosine against precomputed recipe vectors. The
   pure core, `postProcessNeighbours` (drop self, hard-filter, re-rank,
   truncate), is storage-agnostic and unit-tested with no backend. Only the
   scorer underneath swapped from the old Jaccard token-overlap version.

2. **Ingredient to product (pricing and cart).** Match a recipe ingredient
   ("200g spaghetti") to a real supermarket SKU so the basket can be priced per
   store and the Albert Heijn cart filled. Code: `src/lib/pricing/`. The
   ingredient text is embedded and scored by cosine against committed product
   vectors. Cosine top-K is candidate retrieval only; a `generateObject` rerank
   picks the right SKU or declines before any product is accepted. Price totals
   use the same accurate path through `match_cache`, so repeated store/name
   resolutions do not keep paying the model cost. Every match carries a
   confidence flag, so estimated lines never silently inflate the "save money"
   claim.

3. **Replan term-match (exclude and more-of).** A plain-language replan term
   ("no mushrooms", "more pasta") has to find the recipes it refers to so the
   planner can exclude or favour them. The term is embedded and scored by cosine
   against recipe vectors. The hand-maintained synonym maps are gone: the
   embedding gives the synonymy ("champignon" and "paddenstoel" for "mushroom")
   for free.

### The vectors live in one D1, scored brute-force

There is no separate vector database, no Vectorize, no libSQL or Turso. The
catalogue is around 5,000 products and 1,500 recipes, which is far too small for
an approximate-nearest-neighbour index to earn its keep. We wanted embeddings for
recall, not an index for scale, and those are separable: you can store vectors
and score them brute-force.

- The model is OpenAI `text-embedding-3-small` at `dimensions: 256`,
  multilingual and small enough to store cheaply. It is wired through
  `@ai-sdk/openai` as `models.embedding` in `src/lib/models.ts`.
- Each vector is encoded Float32 to base64. Product vectors live in an
  `embedding` blob column on `store_product`; recipe vectors live in a
  `recipe_embedding` table.
- The vectors are committed to `data/embeddings/*` and seeded into D1 by
  `scripts/seed.ts`, the same pattern as the committed price-catalogue snapshot.
  A fresh clone plus a CI run reproduces every matcher with zero API calls.
- At request time the vectors load from D1 into a per-isolate module cache and
  are scored with `cosineSimilarity` from the AI SDK. At this size a linear scan
  is instant. If the catalogue ever grows past the low tens of thousands, the
  escape hatch is to put a real index behind the scorer. Not needed now.

### Honest degradation, no hidden fallback

Two matchers embed live user text and so need an API key at runtime; the rest run
off precomputed vectors or set-maths and do not.

- **Works with no `OPENAI_API_KEY`:** similar-swap (scores against precomputed
  recipe vectors), planning, and week generation (set-maths over rows).
- **Needs `OPENAI_API_KEY` at runtime:** replan term-matching and cart/price
  matching, because both embed text the user just typed. They degrade honestly:
  replan declines with an "AI adjustments off" message, and price matching
  returns `confidence: 'none'` with an honest UI note.
- There is no silent fallback to the old token matcher. Falling back would
  reintroduce the cross-language slop, so a missing key fails loud and honest
  rather than serving worse matches.

## The tools: the model names constraints, never dishes

The replan agent is a bounded tool loop, capped at 8 steps
(`REPLAN_MAX_STEPS` in `src/lib/agent/runner.ts`). The model reads the request,
calls constraint tools, and the working week mutates inside a `WeekSession`. The
crucial design rule: no tool accepts or returns a recipe id or title. The model
names the constraint, and the planner core picks the real recipe. That is how the
hard rule "meal generation is grounded in the recipe table, never hallucinated"
is enforced at the tool boundary.

The replan tools (`src/lib/agent/tools.ts`):

| Tool              | What it does                                               |
| ----------------- | ---------------------------------------------------------- |
| `get_week`        | Read the current week back, day by day.                    |
| `skip_day`        | Clear days (eating out or away).                           |
| `swap_day`        | Replace a day's dinner with the next-best pick.            |
| `exclude`         | Remove an ingredient or cuisine, refill the affected days. |
| `lean_more`       | Favour more of an ingredient or cuisine.                   |
| `make_quicker`    | Replace dinners with shorter-prep ones.                    |
| `set_day_type`    | Mark a day `home`, `busy`, or `out`.                       |
| `add_meal`        | Fill an empty day with the top fit.                        |
| `regenerate_week` | Start a fresh week, keeping day types.                     |

Two memory tools (`src/lib/agent/memory-tools.ts`) let the assistant ground
itself and keep durable facts:

| Tool            | What it does                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recall_memory` | Recall the household's durable preferences, constraints, recent weeks, and feedback.                                                                       |
| `remember`      | Store a fact, with a `kind` (preference, constraint, variety, context, logistics) so nuance survives. "Not pizza every week" is a variety wish, not a ban. |

**One tool surface, two transports.** The chat agent and the voice assistant
share the same tools, names, schemas, and handlers. Chat runs them through
`streamText`; voice dispatches the same set through `src/lib/vapi-dispatch.ts`
(the voice path stamps `source: 'voice'` on anything it remembers). So the two
behave identically. `add_items` and `generate_cart` are reserved on the voice
side and reply honestly that they are not wired up yet.

## Observability: Braintrust traces every AI call

`src/lib/braintrust-ai.ts` wraps the Vercel AI SDK with Braintrust's
`wrapAISDK()`, under the project name "Smart Cart". Every `generateObject`,
`embed`, and `embedMany` call made through it traces to Braintrust automatically:
the spans, the inputs and outputs, and the eval scores. So the embeddings, the
SKU reranks, and the agent runs are all inspectable after the fact, not a black
box. It runs with `asyncFlush: false`, because Cloudflare Workers has no Vercel
`waitUntil` to flush on.

## The evals: behaviour locked, regressions fail the gate

Four evals cover the AI surface. Two run in the pre-push gate so a regression
fails the push; two are run on demand against Braintrust.

### Matcher eval (`scripts/eval.ts`, `pnpm eval`)

Runs the real ingredient-to-SKU pipeline (expand terms, embed, cosine retrieve,
LLM rerank) over 16 golden cases against Albert Heijn. Eight are cross-language
or staple cases (mushroom to champignon, "00 flour" to bloem or meel). Eight are
real cart failures with reject filters that lock the fixes: "chilli flakes" must
not match Doritos, "almond flour" must reject cake, taart, and koek. The pass
threshold is 80%. It is wired into the pre-push hook but only runs when the
matcher files change, so a docs push never pays for it. Every embed and rerank in
the run traces to Braintrust.

### Replan-agent eval (`evals/replan-agent.eval.ts`, `pnpm eval:replan-agent`)

23 tasks across skip, swap, exclude, lean-more, quicker, add-meal, regenerate,
read-only, compound, and deliberately ambiguous cases. Each task is a stubbed
household plus a natural-language instruction plus code-scored expectations. 15
scorers (`src/lib/agent/eval/scorers.ts`) lock the behaviour, including the ones
that matter most for trust:

- `groundedRecipes`: every recipe the agent lands on must exist in the catalogue.
- `noRecipeNamesInMessage` and `toolArgsAreConstraints`: anti-hallucination, the
  model must not name catalogue dishes in its reply or pass recipe ids as tool
  arguments.
- `honestDecline`: when nothing can be done, the message reads as a decline and
  the week does not change.
- `dietRespected`, `termAbsent`, `termMinCount`, `daysCleared`, `daysSwapped`,
  `toolsCalled`, `toolsOrder`, `forbiddenTools`, `weekChanged`,
  `noDuplicateRecipes`, `messageIncludes`.

### Memory-classifier eval (`pnpm eval:memory-classifier`)

A Braintrust dataset that checks the classifier turns a spoken or typed fact into
the right memory `kind` and polarity.

### Benchmark recall gate (ADR-0002, vitest guard in `pnpm quality`)

The preference recommender is gated on Recall@20 against a frozen fixture:
a versioned catalogue, synthetic users, and a fixed RNG seed in
`data/fixtures/benchmark/v1/`, fully deterministic with no database or network.
The baseline lives in `docs/benchmarks/baseline.json`. If any algorithm's recall
at the 20- or 30-swipe checkpoint drops more than 0.02 below baseline, the guard
test fails and names the algorithm. This runs inside `pnpm test`, so a change that
quietly makes recommendations worse cannot merge.

## Why this shape

- **Grounded.** Recipes come from the `recipe` table, SKUs from a real catalogue.
  The model names constraints; it never invents a dish or a product.
- **Explainable and honest.** Every price match carries a confidence flag; a
  missing key degrades with a visible message instead of a silent worse answer.
- **Right tool per job.** Set-maths where it wins (preference), embeddings where
  recall matters (the three matchers), and an LLM at the single point where a
  wrong pick is expensive (the cart).
- **Deterministic and offline.** Committed vectors and frozen fixtures mean a
  cold clone plus CI reproduces every matcher and every eval with zero API calls.
- **Locked.** Evals and the recall gate run in the push gate, so the behaviour
  this design bought stays bought.

## Map of the code

| Area                      | Where                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| Matching design notes     | `docs/matching.md`                                                        |
| Decisions                 | `docs/adr/0001`..`0004` (0004 is the embeddings call)                     |
| Preference recommender    | `src/lib/recsys/`                                                         |
| Dish similarity           | `src/lib/vectors/`                                                        |
| Ingredient to SKU pricing | `src/lib/pricing/`                                                        |
| Embeddings model wiring   | `src/lib/models.ts`, `src/lib/embeddings/`                                |
| Committed vectors         | `data/embeddings/*`                                                       |
| Agent tools               | `src/lib/agent/tools.ts`, `src/lib/agent/memory-tools.ts`                 |
| Agent runner              | `src/lib/agent/runner.ts`                                                 |
| Voice dispatch            | `src/lib/vapi-dispatch.ts`                                                |
| Braintrust wrapper        | `src/lib/braintrust-ai.ts`                                                |
| Matcher eval              | `scripts/eval.ts`                                                         |
| Agent evals               | `src/lib/agent/eval/`, `evals/replan-agent.eval.ts`                       |
| Benchmark gate            | `src/lib/recsys/benchmark.guard.test.ts`, `docs/benchmarks/baseline.json` |
