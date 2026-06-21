# Smart Cart

Thin pointer file. The real context lives in:

- `CONTEXT.md`: what Smart Cart is + the shared domain language + hard rules.
- `docs/decisions.md`: locked decisions (no auto-buy, grounded recipes, Dutch-first) + open questions.
- `docs/PRD.md`: scope, the one flow we polish, sliced into agent-sized issues.
- `AGENTS.md`: TanStack/library skill mappings + the project-context section.

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
