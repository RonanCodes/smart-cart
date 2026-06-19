# Context

The shared language of Smart Cart. Read this before writing code or a PRD so we
all mean the same thing. Keep it short; add a term when it starts getting used.

## What we are

Smart Cart is an **AI household food planner**. It learns how a household eats,
plans the week, and fills a ready-to-order basket at a Dutch supermarket. The user
checks out themselves. We do not buy anything automatically.

The job we remove: the weekly "what's for dinner, and what do I need to buy"
mental load. Not "save money" (that race is crowded and won), but **save time and
mental effort**.

## Ubiquitous language

| Term                     | Means                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Household**            | The unit we plan for. Has a size (adults/children) and one owner (a signed-in user).                                                                                                                                                                                                                                                                                                                                              |
| **Profile**              | What the household tells us + what we learn: allergies, dislikes, diet, calorie goal, budget, favourite store, loved tastes. The thing that gets richer over time.                                                                                                                                                                                                                                                                |
| **Household memory**     | The accumulated learned profile. Our moat: after months we know "loves Mexican, two veggie nights, hates mushrooms, cooks under 30 min, spends €140/week", not just "family of four".                                                                                                                                                                                                                                             |
| **Week menu (plan)**     | Seven (or N) dinners chosen for a household for a given week. Has a status: `draft` → `confirmed` → `shopped`.                                                                                                                                                                                                                                                                                                                    |
| **Recipe**               | A real dish from a scraped catalogue (AH Allerhande, Jumbo Recepten, food.com, TheMealDB), with ingredients (real supermarket products + quantities), dietary tags, calories, prep time, steps. We plan from these, we do not invent them. The catalogue is the 1531-recipe real dataset; the `dinner-plannable`, cuisine, and macro (calories/protein) fields now come from real source data via `scripts/import-recipes-db.ts`. |
| **Basket**               | The shopping list mapped to a specific store's products, priced, ready for the user to open in the AH or Jumbo app and check out.                                                                                                                                                                                                                                                                                                 |
| **Store**                | A supermarket: `ah` (Albert Heijn) or `jumbo` to start. Cross-store is our edge (we are not owned by one chain).                                                                                                                                                                                                                                                                                                                  |
| **Price comparison**     | The same basket costed across stores, so the user sees where it is cheaper.                                                                                                                                                                                                                                                                                                                                                       |
| **Adaptation / replan**  | The killer move: a plain-language change ("we're eating out Wednesday", "spend €20 less", "kids hate broccoli") replans the rest of the week instantly, by chat or voice.                                                                                                                                                                                                                                                         |
| **Swipe**                | The Tinder-style like/dislike/skip on a whole recipe. The fast onboarding intake, stored as `recipe_swipe` rows.                                                                                                                                                                                                                                                                                                                  |
| **Preference algorithm** | The core taste piece. Mostly maths: find the overlap (intersection / Venn) across REJECTED recipes to infer dislikes (no seafood, no Mexican twice) in the fewest swipes, getting the user to their top 20% of meals fast. AI only at decision points.                                                                                                                                                                            |
| **Feedback loop**        | After a meal, thumbs up/down + a note ("not pizza every week"), stored in memory (`meal_feedback`) so the planner stops repeating misses. The nudge fires around eating time. This is our edge over Jow.                                                                                                                                                                                                                          |
| **Jow**                  | jow.com, the French reference. Proof the model works, NOT what we copy. It has no feedback loop, is not really AI, and uses only its own recipes. It will not come to NL (market too small).                                                                                                                                                                                                                                      |
| **Meal swap**            | Replacing one dinner in a confirmed week with another, on the week view. Two flavours: swap for the next-best by preference (planner), or swap for something **similar** (vector neighbour, e.g. "like this but faster").                                                                                                                                                                                                         |
| **Recipe neighbour**     | The nearest recipes to a given one in embedding space (CF Vectorize, cosine). Powers "more like this" and similar-meal swaps. Distinct from preference, which stays set-maths, neighbours are about dish similarity, not taste.                                                                                                                                                                                                   |
| **Replan intent**        | A plain-language change to a week ("eating out Wednesday", "no fish", "swap Friday"). Parsed deterministically for the common cases; the long tail falls back to the AI SDK. Some intents ("make it cheaper") need price data and wait on the basket work.                                                                                                                                                                        |
| **Frozen fixture**       | A committed snapshot of the benchmark inputs (catalogue + synthetic users + RNG seed) under `data/fixtures/benchmark/<version>/`. The swipe benchmark reads ONLY this, never the live `data/seed/` or D1, so it is deterministic and runs with no network. Refresh with `pnpm fixture:freeze` after a deliberate catalogue change.                                                                                                |
| **Benchmark guard**      | The rule that benchmark numbers stay reproducible: the benchmark runs against the frozen fixture, so a code change that shifts recall is visible and intentional, not catalogue drift. (The CI regression-gate test that enforces this lands in a follow-up slice.)                                                                                                                                                               |

## Hard rules

- **No autonomous purchasing.** We plan and fill the basket; the user checks out. A deliberate trust + feasibility decision (see `docs/decisions.md`).
- **No hallucinated recipes.** Meal generation is grounded in the real recipe catalogue (~40k recipes), not free-form LLM output. Random invented recipes are a failure.
- **One recipe per day of the week.** Household size sets portions. No every-second-day mode for now.
- **Dutch-first.** Real products from real Dutch supermarkets (AH, Jumbo). The thing we beat is static, non-learning planners.
- **The loop is the moat.** Learning feedback + AI at decision points + bring-your-own recipes + local AH/Jumbo integration. That is what a single-store locked competitor (Picnic, Jow) cannot match.

## Planner policy (grilled 2026-06-19)

- **Pure preference, no forced variety.** The week is the top dinners by adaptive preference score. We do **not** impose a cuisine-variety constraint. If a household reads as a "Pasta person", a pasta-heavy week is the right answer, not a bug. The only de-dup is: never serve the **exact same recipe** twice in one week.
- **Allergies and diet are hard filters; everything else is soft.** Allergies and vegetarian/vegan are absolute (those recipes are never candidates). Calorie goal, protein, and prep-time are scoring nudges, not filters, so the week always fills 7 days.
- **First week uses the adaptive ranker over the full catalogue**, seeded by the onboarding swipes, not just the explicitly-liked recipes.
- **Replan is chat-first, deterministic + AI fallback.** Voice (#17, VAPI) is deferred. Price-dependent intents ("cheaper") wait on the basket/price work.
- **Similarity is CF-native and read-only over a fixed embedding.** See `docs/adr/0001-cf-vectorize-recipe-similarity.md`.

## The one flow that matters

Swipe onboarding → instant first week (one recipe/day) → adjust by chat/voice →
one-click AH order (show Jumbo, price-only for other stores) → post-meal feedback
into memory. Make this one flow excellent. Everything else is secondary.
