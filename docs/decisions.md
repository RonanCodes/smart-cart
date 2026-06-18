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
5. **Stack:** TanStack Start + Neon Postgres + Better Auth + Resend + Vercel AI SDK on
   Cloudflare Workers. Repo is the single source of truth for context + decisions +
   PRD (not the FigJam).
6. **Data/legal stance:** recipe ingredients + steps are not copyrightable (only the
   surrounding story/images are); we use the recipe data, not verbatim copy, public
   info only. Have a "how we'd license this at scale" answer ready for VC questions.

## Locked on the feature call (2026-06-18)

7. **The one flow:** swipe onboarding, instant first week, chat/voice replan,
   one-click AH order, post-meal feedback loop. See `docs/PRD.md`.
8. **Onboarding is swipe-first** (Tinder/Letterboxd on whole recipes) plus a few
   light form fields. Not a survey.
9. **One recipe per day of the week.** Household size sets portions. No
   every-second-day mode for now (Teije: most families cook every night).
10. **Primary store is Albert Heijn** for the one-click order. Show Jumbo but do
    not build it. For all other stores, show the price only (no recipe-to-cart).
11. **Recipe source of record:** the ~40k scraped recipes (Nicolas). If Teije's
    Food Influencers United API early access lands, it does the recipe-to-product
    step for us, which would free time for breakfast/lunch/snacks. Pending.
12. **The moat is the learning loop**, not auto-buy. Feedback into memory, AI at
    decision points, bring-your-own recipes, local AH/Jumbo integration.
13. **Swipe algorithm** (Ronan): find intersections across rejected recipes, fewest
    swipes to the user's top 20%, AI only at decision points.
14. **Name: still open** (Smart Cart is provisional, Mega42 / Eurobuild also live).

## Still open

- The exact 1-2 replan scenarios shown live in the demo.
- The product name (and whether to buy a domain).
- Whether the Food Influencers United API early access comes through.
