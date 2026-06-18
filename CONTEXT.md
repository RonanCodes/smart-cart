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

| Term                     | Means                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Household**            | The unit we plan for. Has a size (adults/children) and one owner (a signed-in user).                                                                                                                                                                   |
| **Profile**              | What the household tells us + what we learn: allergies, dislikes, diet, calorie goal, budget, favourite store, loved tastes. The thing that gets richer over time.                                                                                     |
| **Household memory**     | The accumulated learned profile. Our moat: after months we know "loves Mexican, two veggie nights, hates mushrooms, cooks under 30 min, spends €140/week", not just "family of four".                                                                  |
| **Week menu (plan)**     | Seven (or N) dinners chosen for a household for a given week. Has a status: `draft` → `confirmed` → `shopped`.                                                                                                                                         |
| **Recipe**               | A real dish from a scraped catalogue (AH Allerhande, Jumbo Recepten, open datasets), with ingredients (real supermarket products + quantities), dietary tags, calories, prep time, steps. We plan from these, we do not invent them.                   |
| **Basket**               | The shopping list mapped to a specific store's products, priced, ready for the user to open in the AH or Jumbo app and check out.                                                                                                                      |
| **Store**                | A supermarket: `ah` (Albert Heijn) or `jumbo` to start. Cross-store is our edge (we are not owned by one chain).                                                                                                                                       |
| **Price comparison**     | The same basket costed across stores, so the user sees where it is cheaper.                                                                                                                                                                            |
| **Adaptation / replan**  | The killer move: a plain-language change ("we're eating out Wednesday", "spend €20 less", "kids hate broccoli") replans the rest of the week instantly, by chat or voice.                                                                              |
| **Swipe**                | The Tinder-style like/dislike/skip on a whole recipe. The fast onboarding intake, stored as `recipe_swipe` rows.                                                                                                                                       |
| **Preference algorithm** | The core taste piece. Mostly maths: find the overlap (intersection / Venn) across REJECTED recipes to infer dislikes (no seafood, no Mexican twice) in the fewest swipes, getting the user to their top 20% of meals fast. AI only at decision points. |
| **Feedback loop**        | After a meal, thumbs up/down + a note ("not pizza every week"), stored in memory (`meal_feedback`) so the planner stops repeating misses. The nudge fires around eating time. This is our edge over Jow.                                               |
| **Jow**                  | jow.com, the French reference. Proof the model works, NOT what we copy. It has no feedback loop, is not really AI, and uses only its own recipes. It will not come to NL (market too small).                                                           |

## Hard rules

- **No autonomous purchasing.** We plan and fill the basket; the user checks out. A deliberate trust + feasibility decision (see `docs/decisions.md`).
- **No hallucinated recipes.** Meal generation is grounded in the real recipe catalogue (~40k recipes), not free-form LLM output. Random invented recipes are a failure.
- **One recipe per day of the week.** Household size sets portions. No every-second-day mode for now.
- **Dutch-first.** Real products from real Dutch supermarkets (AH, Jumbo). The thing we beat is static, non-learning planners.
- **The loop is the moat.** Learning feedback + AI at decision points + bring-your-own recipes + local AH/Jumbo integration. That is what a single-store locked competitor (Picnic, Jow) cannot match.

## The one flow that matters

Swipe onboarding → instant first week (one recipe/day) → adjust by chat/voice →
one-click AH order (show Jumbo, price-only for other stores) → post-meal feedback
into memory. Make this one flow excellent. Everything else is secondary.
