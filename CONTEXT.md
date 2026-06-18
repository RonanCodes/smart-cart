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

| Term                    | Means                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Household**           | The unit we plan for. Has a size (adults/children) and one owner (a signed-in user).                                                                                                                                                 |
| **Profile**             | What the household tells us + what we learn: allergies, dislikes, diet, calorie goal, budget, favourite store, loved tastes. The thing that gets richer over time.                                                                   |
| **Household memory**    | The accumulated learned profile. Our moat: after months we know "loves Mexican, two veggie nights, hates mushrooms, cooks under 30 min, spends €140/week", not just "family of four".                                                |
| **Week menu (plan)**    | Seven (or N) dinners chosen for a household for a given week. Has a status: `draft` → `confirmed` → `shopped`.                                                                                                                       |
| **Recipe**              | A real dish from a scraped catalogue (AH Allerhande, Jumbo Recepten, open datasets), with ingredients (real supermarket products + quantities), dietary tags, calories, prep time, steps. We plan from these, we do not invent them. |
| **Basket**              | The shopping list mapped to a specific store's products, priced, ready for the user to open in the AH or Jumbo app and check out.                                                                                                    |
| **Store**               | A supermarket: `ah` (Albert Heijn) or `jumbo` to start. Cross-store is our edge (we are not owned by one chain).                                                                                                                     |
| **Price comparison**    | The same basket costed across stores, so the user sees where it is cheaper.                                                                                                                                                          |
| **Adaptation / replan** | The killer move: a plain-language change ("we're eating out Wednesday", "spend €20 less", "kids hate broccoli") replans the rest of the week instantly.                                                                              |

## Hard rules

- **No autonomous purchasing.** We plan and fill the basket; the user checks out. This is a deliberate trust + feasibility decision (see `docs/decisions.md`).
- **No hallucinated recipes.** Meal generation is grounded in the scraped recipe catalogue, not free-form LLM output. Random invented recipes are a failure.
- **Dutch-first.** Real products from real Dutch supermarkets (AH, Jumbo). English/US meal-planners are the thing we beat.

## The one flow that matters

Onboard (3-4 questions) → generate the week menu → fill the basket → (adapt on request).
Make this one flow excellent. Everything else is secondary.
