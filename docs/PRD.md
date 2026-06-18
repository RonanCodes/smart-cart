# PRD: Smart Cart

The spec is locked (feature call 2026-06-18). Read `CONTEXT.md` and
`docs/decisions.md` first. An AI meal planner built on top of SlimMandje. One
clear flow, a demo that lands three "aha" moments live.

## 1. Problem

Every week a household has to decide what to eat, account for everyone's diet,
allergies and taste, build a list, and buy it. The mental load happens before
checkout, and people skip cooking because deciding plus shopping is too much
effort.

## 2. Who it's for

Busy Dutch households (couples, families) who already shop at Albert Heijn or
Jumbo. Demo persona: a family planning the week's dinners.

## 3. The one flow (this is the whole product)

1. **Onboarding**: swipe recipes (Tinder / Letterboxd style) plus a few light
   form fields (household size, allergies). Fast and fun, never a survey.
2. **Instant first week** (aha 1): right after onboarding, generate a week of
   dinners, one per day. Imperfect is fine; instant value is the point.
3. **Adjust by chat or voice** (aha 2): "I'm eating out Wednesday", "make it
   cheaper". One or two cases is enough for the demo.
4. **One-click order at Albert Heijn** (aha 3): map the week to a real AH basket.
   Show Jumbo but do not build it. For other stores, show the price only.
5. **Feedback loop**: after a meal, thumbs up or down plus a note ("not pizza
   every week"), stored in memory so it stops suggesting the same things. The
   feedback nudge fires around eating time.

## 4. The differentiators (the moat, for the pitch)

- A genuine **learning feedback loop** (Jow has none).
- **AI at the decision points** (Jow is not really AI based).
- **Bring many recipes, including your own** (Jow leans on its own database).
- **Local AH/Jumbo integration** that changes constantly, which foreign players
  (Jow) will not chase because NL is too small.
- Pitch triangle: **save money, save time, reduce food waste**.

## 5. Out of the main flow (build only if there is time)

- Pantry / fridge scan. Exists elsewhere, fiddly, a side feature, not the killer.
- Social recipe feed (TikTok / Instagram style). A later addition.
- Breakfast / lunch / snacks (only if the Food Influencers United API lands and
  frees up product-matching time).

## 6. The demo

Get a judge or audience member to onboard live so the system nails their real
favourites. An admin portal triggers the feedback notification on cue (time
travel). Light acting: a family planning the week, shopping, eating, then giving
feedback. Note: Picnic's CTO is a judge, so be ready for "why won't Picnic just
do this" (answer: the learning loop plus cross-store plus bring-your-own, which a
single-store locked loop cannot match).

---

## Vertical slices (own one, stay in your own files)

The shared seam is the database, and it is already defined in full
(`src/db/schema.ts`: `household`, `recipe`, `recipe_swipe`, `meal_plan`,
`meal_feedback`, auth). Nobody should need to edit `schema.ts` during the build,
so slices read and write existing tables and otherwise stay in their own folder.
That is how we avoid merge conflicts.

| #   | Slice                             | Owner         | Lives in (own these files)                                               | Reads/writes                                     |
| --- | --------------------------------- | ------------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| 1   | Recipe catalogue + seed           | Nicolas       | `scripts/seed-recipes.ts`, `data/recipes/`                               | `recipe`                                         |
| 2   | Swipe onboarding UI + light forms | Teije + Ronan | `src/routes/onboarding.tsx`, `src/components/onboarding/*`               | `recipe`, `recipe_swipe`, `household`            |
| 3   | Preference algorithm (the maths)  | Ronan         | `src/lib/preferences/*`                                                  | reads `recipe_swipe`, writes `household.profile` |
| 4   | Week generation (grounded)        | Ronan         | `src/lib/planner/*`, `src/routes/api/plan.ts`                            | reads `recipe` + profile, writes `meal_plan`     |
| 5   | Week view + chat/voice replan     | Ronan         | `src/routes/week.tsx`, `src/components/week/*`, `src/lib/agent/*`        | `meal_plan`                                      |
| 6   | Product match + AH basket + price | Nicolas       | `src/lib/product-match/*`, `src/lib/pricing/*`, `src/routes/api/cart.ts` | `recipe`, `meal_plan`                            |
| 7   | Feedback loop + memory            | Ronan         | `src/lib/feedback/*`, `src/routes/feedback.tsx`                          | `meal_feedback`, `household.profile`             |
| 8   | Admin portal (demo notifications) | open          | `src/routes/admin/*`, `src/lib/notify/*`                                 | `meal_plan`, `meal_feedback`                     |
| 9   | Voice agent (VAPI), optional      | Ronan         | `src/lib/voice/*`                                                        | calls slice 5                                    |

Rules of the road (Teije's ask): Ronan sets up the lint/test rules and reviews
PRs. Branch off `main`, one slice per PR, squash-merge. First hour on the day: write
everything down and mock the screens, then split. For product matching, fake it
till you make it if the real integration does not hold.

## How we know it works

- A real person onboards and gets a sensible, non-hallucinated week in under a minute.
- The week maps to real AH products for the one-click basket.
- A plain-language change visibly replans the week.
- Feedback changes what gets suggested next.
