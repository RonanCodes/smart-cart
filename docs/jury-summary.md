# Souso (Smart Cart) — Jury Summary

**One line:** An AI household food planner that learns how you eat, plans your week, and fills a ready-to-order basket at Albert Heijn or Jumbo. You check out yourself — we never touch your money.

**Live demo:** [smartcart.ronanconnolly.dev](https://smartcart.ronanconnolly.dev)

---

## The problem

Every week, Dutch households face the same grind: decide what to eat, respect everyone's diet and allergies, build a shopping list, and buy it. The pain is **before checkout** — the mental load of deciding plus shopping. People skip cooking not because they dislike food, but because planning is too much effort.

## What we built

| Feature | What it does |
| -------- | ------------- |
| **Swipe onboarding** | Tinder-style like/dislike on real recipes — fast taste intake, not a survey |
| **Instant first week** | Seven dinners (one per day) generated immediately after onboarding |
| **Household memory** | Learns allergies, dislikes, diet, budget, store preference, and feedback over time |
| **Chat replan** | Plain-language changes ("eating out Wednesday", "no fish", "make it cheaper") replan the week |
| **Real recipe catalogue** | ~40k scraped recipes (AH Allerhande, Jumbo, open datasets) — never invented by AI |
| **AH basket fill** | Maps the week to real Albert Heijn products, ready to open in the AH app |
| **Cross-store pricing** | Same basket costed across AH and Jumbo so users see where it's cheaper |
| **Post-meal feedback** | Thumbs up/down + notes after meals; the planner stops repeating misses |
| **Similar-meal swap** | Replace a dinner with something similar (embeddings) or next-best by preference |

### The core loop

```
learn  →  plan  →  fill basket  →  cook & rate
   ▲                                    │
   └────────────────────────────────────┘
```

---

## Why we're different

- **Learning feedback loop** — competitors like Jow don't learn from what you actually ate
- **AI at decision points** — preference ranking is mostly maths; LLMs handle replan and cart matching, not free-form recipe invention
- **Cross-store** — not locked to one supermarket chain
- **Grounded in real recipes + real products** — Dutch AH/Jumbo integration that foreign players won't chase (NL market too small)
- **Trust by design** — we plan and fill the basket; the user always checks out

**Pitch triangle:** save time, reduce mental load, optional price comparison (not our headline — ~20 NL price apps already exist).

---

## Important decisions (locked)

### Product & trust

1. **No autonomous purchasing.** We never buy groceries for the user. Supermarkets don't support it, ~55% of users don't trust AI with their money, and it removes checkout/ToS complexity. Pitch: *"food planner that builds a ready-to-order basket"*, not *"AI that buys your groceries"*.

2. **No hallucinated recipes.** Meals come only from the scraped catalogue. Random LLM-invented recipes are a failure mode we explicitly reject.

3. **Dutch-first (AH + Jumbo).** Real in-store products. Primary one-click order is Albert Heijn; Jumbo is shown for comparison.

4. **Mental load + time, not money.** Price comparison is a feature, not the wedge. The crowded "save money" race is already lost in NL.

5. **One recipe per day.** Household size sets portions. No every-second-day mode for now.

### Algorithm & data

6. **Preference = set maths, not vibes.** Swipe onboarding finds overlap across rejected recipes to infer dislikes in the fewest swipes. AI only at decision points (replan, cart rerank).

7. **Single Cloudflare D1 database.** SQLite holds everything — recipes, plans, embeddings, auth. No separate vector DB; catalogue size makes exact matching practical.

8. **Embeddings for similarity, maths for taste.** Dish neighbours and ingredient-to-product matching use OpenAI embeddings; preference ranking stays benchmarked set-maths.

### Monetisation (Souso)

9. **Tip on add-to-cart, never on groceries.** Revenue is an optional tip when filling the basket (Mollie, iDEAL-first). AH/Jumbo always take the grocery payment.

10. **Free tier, then default tip.** First 3 add-to-cart actions per month free; then a tip slider defaults to 3% (user can lower to 1%, raise to 5%, or tap "no tip").

11. **Reward, never guilt.** The Souso mascot reacts with positive-only emotion — never sad or disappointed when someone declines. Deliberate anti-dark-pattern stance.

---

## Stack (brief)

TanStack Start · React 19 · Cloudflare Workers + D1 · Drizzle · Better Auth · Vercel AI SDK · Resend

---

## If they ask…

**"Why won't Picnic just do this?"**  
Picnic is single-store and locked to their own loop. We win on cross-store choice, a genuine learning feedback loop, bring-your-own recipes, and not needing to own checkout.

**"How is this different from Jow?"**  
Jow has no post-meal feedback loop, isn't really AI-driven, and uses only its own recipes. It also won't come to NL — market too small. We're built for Dutch supermarkets from day one.

**"Do you use AI to invent recipes?"**  
No. AI parses replan requests and helps match ingredients to products. The week is built from real scraped recipes only.

**"How do you make money without charging for groceries?"**  
Optional tip when the user fills their basket — paid for the planning value, not the food.

**"What's still open?"**  
Product name (Souso / Smart Cart provisional), exact demo replan scenarios, and fine-tuning of the tip model after user testing.

---

*Sources: `CONTEXT.md`, `docs/decisions.md`, `docs/PRD.md`*
