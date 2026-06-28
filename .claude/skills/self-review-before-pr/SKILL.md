---
name: self-review-before-pr
description: Review your own diff against the Souso quality checklist BEFORE opening any PR. Catches ownership violations (edited a Nic-owned file), missing reproduce-first tests, synonym/heuristic maps where embeddings belong, unbounded AI work on request paths, slop and debug leftovers, copy-rule breaks, and wrong branch target. Fix every issue before you open the PR. Read at the end of any change, just before `gh pr create`.
---

# Self-review before you open a PR

You are about to open a PR. Stop and review your own diff first. Run
`git diff origin/main...HEAD` (or your branch's diff) and walk every item below.
**Fix issues before opening the PR**, not in review. The point is that the PR
arrives already clean.

## The checklist

### (a) Ownership

Did I touch a Nic-owned file? The owned flows are:

- `src/lib/recsys/`, `src/lib/agent/` (onboarding to recipes, week generation);
- recipe-to-ingredient mapping;
- the AH matcher: `src/lib/pricing/*` (`match*.ts`, `resolve-lines.ts`,
  `expand-ingredient.ts`, `rerank-sku.ts`, `match-cache.ts`);
- `src/lib/cart-build.ts`, `src/lib/cart-links*.ts`, `src/lib/open-store-cart.ts`,
  `src/lib/shopping/` (add-to-cart, the three cart invariants);
- `src/lib/mollie.ts`, `src/routes/api/mollie/` (Mollie tipping).

If your diff changes any of these internals, back it out and work at the
call-site instead. If you believe one has a real bug, write the failing
test/eval that reproduces it and raise it; do not silently rewrite it. See
`ship-flow-and-ownership`.

### (b) Reproduce-first

Is there a test for this change? For a bug or feedback, is there a test that
**fails before the fix and passes after** (a real regression test, not one that
would also have passed before)? For an AI behaviour change, is there an eval
case (golden or reject) that locks it? No fix ships without the test that would
have caught it. See `reproduce-first-tdd`.

### (c) No synonym / heuristic maps where embeddings belong

Did I add a synonym table, substring/token-overlap match, exclusion group, or
any hand-maintained term map for something the matcher's embeddings already
handle? If so, remove it and use the matcher. See `ai-safe-and-fast`,
`docs/adr/0004`.

### (d) AI / heavy work on request paths is bounded

Does any new request-path code fan out per-item over a potentially large input
(embeds, LLM calls, D1 subrequests)? Workers have a hard memory/CPU cap. It must
be bounded, chunked, batched, and degrade rather than crash. See
`bounded-ai-on-request-paths`, `docs/adr/0005`.

### (e) No slop / dead code / debug leftovers

Scan for `console.log`, commented-out blocks, unused imports/vars, TODO stubs,
speculative abstractions added "just in case", and copy-pasted boilerplate the
change does not need. Delete them.

### (f) Copy rules

Any prose a human reads (UI copy, docs, PR description, commit body):
**no em-dashes or en-dashes** (use commas, colons, full stops, or parentheses),
and **no AI-tell filler** (delve, leverage, robust, seamless, streamline,
"not just X but Y", gratuitous tricolons). Prefer the plainer sentence.

### (g) Branch flow

Am I targeting the right branch? Feature work opens a PR into **`develop`**, not
`main`. Only `develop` PRs into `main` (the promotion-to-prod gate). I branched
off the latest `origin/main`, commits are emoji-conventional, and the local gate
(`pnpm quality`) is green. See `CONTRIBUTING.md`.

## After the pass

If any item failed, fix it now and re-run the relevant part of `pnpm quality`.
Only open the PR once all seven are clean.
