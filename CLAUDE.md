# Smart Cart

Thin pointer file. The real context lives in:

- `CONTEXT.md`: what Smart Cart is + the shared domain language + hard rules.
- `docs/decisions.md`: locked decisions (no auto-buy, grounded recipes, Dutch-first) + open questions.
- `docs/PRD.md`: scope, the one flow we polish, sliced into agent-sized issues.
- `AGENTS.md`: TanStack/library skill mappings + project context + the shared
  "Engineering principles (all agents)" section.
- `.claude/skills/`: the shared engineering skills every agent inherits.
  Read the relevant one before the matching work:
  - `ai-safe-and-fast`: embeddings (not synonym maps), LLM at decision points,
    deterministic for reproducible, safe/fast/verifiable. (ADR-0004)
  - `bounded-ai-on-request-paths`: bound/chunk/batch/degrade AI work on request
    paths; the `/shopping` 1101 lesson. (ADR-0005)
  - `reproduce-first-tdd`: failing test first, then the minimum fix.
  - `ship-flow-and-ownership`: ship flow + which deep flows are owned (work at
    the call-site, do not edit the matcher/pricing/cart/Mollie internals).

Hard rules: no autonomous purchasing (fill the basket, user checks out); meal
generation is grounded in the `recipe` table, never hallucinated; AH/Jumbo first.

## Way of working: TDD (mandatory)

This repo is **test-driven**. For every change, especially a **bug fix, a Sentry
issue, or a user-reported issue**: write a FAILING test that reproduces the
problem FIRST, then make it pass. No fix ships without a test that would have
caught it. The three cart invariants (AH-URL faithfulness, grams, ingredients↔
recipes) and the matcher eval are the model: behaviour is locked by tests that
run in `pnpm quality`, so a regression fails the gate. Sentry + user issues are
always test-first (see canon `sentry-user-issues-tdd`).

Ship flow: feature branch off `main` → PR → squash-merge into `main` (auto-deploys
via GitHub Actions on merge — no local `pnpm deploy` needed). Never push to `main`
directly. Commits use emoji-conventional format. The pre-push hook runs the full
gate (`pnpm quality`).
