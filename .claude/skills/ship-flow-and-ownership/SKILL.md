---
name: ship-flow-and-ownership
description: How work ships in Souso (branch to PR to squash-merge, local gate is the real gate, never push main, emoji-conventional commits) and who owns which code. Nic owns the deep AI/data flows (onboarding-to-recipes, recipe-to-ingredients, the AH matcher, add-to-cart, Mollie tipping). Work at the call-site, do not edit those internals. Read before opening a PR or touching pricing/matcher/cart/Mollie code.
---

# Ship flow and ownership

## Ship flow

1. **Branch off the latest `origin/main`.** Fetch first; never branch off a
   stale local checkout. Never push to `main` directly.
2. **One PR per change.** Open it against `main`.
3. **The local gate is the real gate.** The pre-push hook runs `pnpm quality`:
   build, lint, format-check, typecheck, tests, the evals (matcher eval runs
   when matcher files change), and the recall benchmark gate. If pre-push is
   green, the code is good. GitHub Actions is CD-only (it deploys on merge); do
   not sit waiting on remote checks.
4. **Squash-merge into `main`.** Merge auto-deploys via GitHub Actions; no local
   `pnpm deploy` needed.
5. **Commits are emoji-conventional**, e.g. `🐛 fix: ...`, `📝 docs: ...`,
   `✨ feat: ...`, `🧹 chore: ...`. No Co-Authored-By line.

## Ownership: work at the call-site, not inside these

These deep flows are Nic's. They are correct by design and locked by evals.
**Do not edit their internals.** When your work touches them, work at the
call-site: bound how much you hand them, read their output, wire them into a
screen, but do not change how they resolve.

| Flow                  | Where                                                                                                            | What it owns                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Onboarding to recipes | `src/lib/recsys/`, `src/lib/agent/` (week generation)                                                            | Swipe-to-profile, the adaptive preference recommender, week ranking. Gated on recall (ADR-0002).      |
| Recipe to ingredients | recipe-to-ingredient mapping                                                                                     | How a recipe expands into the ingredient lines that get priced.                                       |
| The AH matcher        | `src/lib/pricing/*` (`match*.ts`, `resolve-lines.ts`, `expand-ingredient.ts`, `rerank-sku.ts`, `match-cache.ts`) | Ingredient-to-SKU: embed, cosine retrieve, LLM rerank, cache. The wrong-type guards and reject cases. |
| Add-to-cart           | `src/lib/cart-build.ts`, `src/lib/cart-links*.ts`, `src/lib/open-store-cart.ts`, `src/lib/shopping/`             | Building the basket and the faithful AH cart URL from resolved SKUs. The three cart invariants.       |
| Mollie tipping        | `src/lib/mollie.ts`, `src/routes/api/mollie/`                                                                    | The optional-tip payment flow (decisions 16-19).                                                      |

If you think one of these has a bug, follow `reproduce-first-tdd`: write the
failing test/eval case that reproduces it, then raise it. Do not silently
rewrite the internals.

## What you can change freely

Call-sites, screens, route loaders and guards, your own new features, docs,
skills, CI. The `/shopping` 1101 fix (ADR-0005) is the model: a P0 in an
owned flow, fixed entirely at the call-site (`chunkLines` / `mergeChunkBaskets`)
with no matcher internals touched.

## Process that works here

- **Deep research to plan.md to build executor.** One person researches deep and
  writes the plan; the other drives the coding agent. Less conflict, more
  momentum.
- **Validate the plan with a strong model before building.** The embedding plan
  was checked by Opus, which caught the Worker-size ceiling (a real pre-mortem
  win, see ADR-0005).
- **Document as you go.** Capture the Claude session / what is in your head in
  docs, ADRs, AGENTS.md, CLAUDE.md, or a skill, so a fresh agent picks up cold.
- **Pragmatic minimalism.** "The stupider the agent the better when it's
  specific." Ship the POC flow; improve what shows. Do not over-build.
