# Contributing to Souso

This is the shared flow and quality bar for everyone working on Souso: Ronan,
Nic, TJ, and the coding agents (Claude on `.claude/skills/`, Codex/Cursor on
`AGENTS.md`). Read it once; it is short on purpose.

## The promotion flow (enforced by branch protection)

Two protected branches, one direction of travel. No direct pushes to either.

```
feature branch ──PR──> develop ──(test on dev.souso.app)──> develop ──PR──> main
                         │                                                    │
                  deploys to dev.souso.app                          deploys to prod (souso.app)
```

1. **Branch off the latest `origin/main`.** Fetch first; never branch off a
   stale local checkout.
2. **Open your PR into `develop`** (not `main`). A PR is required; merging it
   deploys to **dev.souso.app**.
3. **Test your change on dev.souso.app.** It is the safe sandbox (see Dev env
   below). Walk the core flow: onboarding to build week to cart to order.
4. **Promote `develop` to `main` with a `develop` → `main` PR.** Only `develop`
   can PR into `main`. That PR must pass, all at once:
   - the **CI gate** (`pnpm quality`);
   - the **"PR into main must come from develop"** check;
   - the **"Verified on dev.souso.app"** checkbox in the PR template, ticked;
   - **1 approval** (Ronan or Nic).
5. Merging the `develop` → `main` PR **deploys to prod (souso.app)**.

No direct pushes to `develop` or `main`. Only `develop` can PR into `main`.

## The local gate

The pre-push hook runs `pnpm quality`: format, lint, typecheck, build, tests,
and the matcher eval. If pre-push is green, the code is good; GitHub Actions is
CD-only (it deploys on merge). Do not sit waiting on remote checks.

Commits are **emoji-conventional**: `🐛 fix: ...`, `✨ feat: ...`,
`📝 docs: ...`, `🧹 chore: ...`. No Co-Authored-By line.

## Reproduce-first TDD

Any bug or piece of feedback starts with a **failing test that reproduces it**,
then the minimum fix, then refactor. A new feature ships with tests. A fix
without the test that would have caught it does not merge. See
`.claude/skills/reproduce-first-tdd/` and `docs/decisions.md`.

## Ownership

Nic owns the deep AI/data flows. **Work at the call-site; do not edit those
internals.** Bound what you hand them, read their output, wire them into a
screen, but do not change how they resolve. The owned flows:

- onboarding to recipes (week generation);
- recipe to ingredients;
- the AH matcher (`src/lib/pricing/*`);
- cart-build / cart-links / add-to-cart;
- Mollie tipping.

If you think one has a bug, follow reproduce-first TDD: write the failing
test/eval that reproduces it, then raise it. Do not silently rewrite the
internals. Full map: `.claude/skills/ship-flow-and-ownership/`.

## The AI rules

One line each; the linked skill or ADR has the reasoning.

- **Embeddings, not synonym maps.** The matcher's embeddings already give
  cross-language semantics; never hand-maintain a synonym/substring/token-overlap
  table. `.claude/skills/ai-safe-and-fast/`, `docs/adr/0004`.
- **LLM only at decision points.** Replan intent, SKU rerank, substitution
  confirm. Anything reproducible (ranking, hard allergy/diet filters,
  consolidation, cart-URL building) stays deterministic.
  `.claude/skills/ai-safe-and-fast/`.
- **Deterministic for reproducible things.** Same input, same output: keep it
  out of the LLM so it can be tested and locked by evals. `docs/adr/0006`.
- **Bound and batch AI on request paths.** Workers have a hard memory/CPU cap and
  D1 has subrequest limits. Bound, chunk, batch, and degrade rather than crash
  (this caused the `/shopping` 1101; the fix chunked the price compare at the
  call-site). `.claude/skills/bounded-ai-on-request-paths/`, `docs/adr/0005`.

## Dev env

**dev.souso.app** is the safe sandbox: a separate dev D1 (seeded), so you can
test without touching prod data. A **DEV ribbon** and a **dev icon** mark it so
you always know which environment you are looking at. Test every change there
before promoting `develop` to `main`.

## Where things live

- `CLAUDE.md`: pointer file + way of working for Claude.
- `AGENTS.md`: skill mappings + project context + pre-PR checklist for
  Codex/Cursor agents.
- `.claude/skills/`: the engineering principles in long form
  (`ship-flow-and-ownership`, `reproduce-first-tdd`, `ai-safe-and-fast`,
  `bounded-ai-on-request-paths`, `self-review-before-pr`).
- `docs/adr/`: the locked architecture decisions (0001 to 0006).
- `docs/brand/`: brand guidelines and voice/tone.
- `CONTEXT.md` / `docs/decisions.md` / `docs/PRD.md`: what Souso is, the locked
  decisions, the scope.
