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

## Open (decide on the features call)

- The exact onboarding questions (which 3-4, in what order).
- Week size and meal types (dinners only, or breakfast/lunch too?).
- The single demo flow we polish for the pitch.
- Which store is primary for the basket demo (AH or Jumbo).
- Recipe source of record for the demo: scraped set vs a recipe-API early-access deal
  (Teije has a lead) vs a curated small set.
- Product name (Smart Cart is provisional).

## How we turn this into work

After the features call: write `docs/PRD.md`, then slice it into small vertical
issues an agent (Codex / Claude) can pick up one at a time. Keep each issue to one
flow step.
