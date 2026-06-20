# Decisions

Hard-to-reverse calls, captured so we don't relitigate them and so an agent can
pick up cold. One line each; expand only when it bit us.

## Locked

1. **No autonomous purchasing.** We plan and fill the basket; the user checks out.
   Why: supermarkets do not support programmatic auto-purchase (integration is a
   nightmare or impossible), and ~55% of users do not trust AI to spend their money.
   Removing it kills the trust objection, the payment/checkout complexity, and the
   ToS risk, and still solves ~80% of the pain. Pitch becomes "food planner that
   builds a ready-to-order basket", not "AI that buys your groceries".
2. **Meal generation is grounded in a real recipe catalogue**, not free-form LLM.
   Why: free generation hallucinates "random" recipes and wrong products. We scrape
   AH Allerhande, Jumbo Recepten, and open datasets into the `recipe` table and plan
   from those.
3. **Dutch supermarkets first (AH + Jumbo).** Real, in-store products. Cross-store is
   the edge; we are not owned by one chain.
4. **The wedge is mental load + time, not money.** Price comparison is a feature, not
   the headline. ~20 NL price-compare apps already exist and are free; that race is lost.
5. **Stack:** TanStack Start + Better Auth + Resend + Vercel AI SDK on Cloudflare
   Workers. Repo is the single source of truth for context + decisions + PRD (not the
   FigJam). _(This line originally said "Neon Postgres"; the running code is Cloudflare
   D1 / SQLite. See locked item 15 + ADR-0003.)_
6. **Data/legal stance:** recipe ingredients + steps are not copyrightable (only the
   surrounding story/images are); we use the recipe data, not verbatim copy, public
   info only. Have a "how we'd license this at scale" answer ready for VC questions.

## Locked on the feature call (2026-06-18)

7. **The one flow:** swipe onboarding, instant first week, chat/voice replan,
   one-click AH order, post-meal feedback loop. See `docs/PRD.md`.
8. **Onboarding is swipe-first** (Tinder/Letterboxd on whole recipes) plus a few
   light form fields. Not a survey.
9. **One recipe per day of the week.** Household size sets portions. No
   every-second-day mode for now (most families cook every night).
10. **Primary store is Albert Heijn** for the one-click order. Show Jumbo but do
    not build it. For all other stores, show the price only (no recipe-to-cart).
11. **Recipe source of record:** the ~40k scraped recipes. If a recipe-to-product
    API early access lands, it does the recipe-to-product step for us, which would
    free time for breakfast/lunch/snacks. Pending.
12. **The moat is the learning loop**, not auto-buy. Feedback into memory, AI at
    decision points, bring-your-own recipes, local AH/Jumbo integration.
13. **Swipe algorithm:** find intersections across rejected recipes, fewest
    swipes to the user's top 20%, AI only at decision points.
14. **Name: still open** (Smart Cart is provisional, Mega42 / Eurobuild also live).

## Locked on the data layer (2026-06-20)

15. **One Cloudflare D1 (SQLite) database holds everything. No libSQL/Turso, no separate
    vector DB.** Why: the build runs on a small curated catalogue, so exact set-maths
    beats any managed ANN index; libSQL cannot run inside a Worker (Turso would be an
    external hop for nothing); and all matching is set-maths (no vectors), so there is
    nothing to put in a vector store. Full reasoning: ADR-0003. Matching architecture:
    `docs/matching.md`.

## Locked on the monetisation call (2026-06-20)

16. **Monetisation is a tip on add-to-cart, not a grocery charge.** We never take the
    grocery payment (AH/Jumbo do, hard rule #1). Souso's revenue is an optional tip the
    user adds when they fill the basket. This keeps decision #1 intact: we are paid for
    the planning, not for buying groceries. Payments run through Mollie (iDEAL-first, NL).
17. **Free tier then a default tip.** First 3 add-to-cart actions per month are free. After
    that the tip slider appears on every add-to-cart, defaulting to 3% of the basket, the
    user can slide it down (to 1%, or any whole percent up to 5%) or tap "no tip".
18. **Reward, never guilt (the anti-dark-pattern rule).** The Souso mascot reacts to the
    tip level with _positive-only_ emotion: neutral-and-kind at no-tip (never sad or
    disappointed), happier as the tip climbs (1% happy → 5% over the moon). We do not
    punish declining. The UI labels it an optional default-on fee, not a "tip" if the
    default is on, so it is honest. This is a deliberate stance we can defend to judges
    and users: tipping made delightful without manipulation.
19. **Fee floor + one-tap repeat.** Charge a minimum (1%, min €0.50) so small baskets do
    not cost us money on Mollie's per-transaction fee. Use a Mollie mandate / recurring
    payment so repeat tips are one-tap, not a full iDEAL redirect each time (demo can use
    a single iDEAL/card charge; mandate is the production path).

## Still open

- The exact 1-2 replan scenarios shown live in the demo.
- The product name (and whether to buy a domain).
- Whether a recipe-to-product API early access comes through.
- Tip model: exact free-tier reset (calendar month vs rolling 30 days), and whether the
  free counter is per-household or per-user.
- Whether the default tip % (3%) survives user testing or should start lower.
