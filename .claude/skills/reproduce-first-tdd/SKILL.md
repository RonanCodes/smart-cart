---
name: reproduce-first-tdd
description: Souso is strict TDD. Any bug, Sentry issue, or user-reported feedback starts with a FAILING test that reproduces it, then the minimum fix, then refactor. The regression test ships with the fix. Evals and the three cart invariants are part of the gate, so a regression fails the push. Read before fixing anything or adding a feature.
---

# Reproduce first, then fix

This repo is test-driven. It is not optional and it is not "write tests after".
For every change, especially a bug fix, a Sentry issue, or a user-reported
problem: the failing test comes first.

## The loop

1. **Reproduce.** Write a test that fails _because the bug exists_. It must go
   red for the right reason before you touch any production code. If you cannot
   make it fail, you have not understood the bug yet.
2. **Minimum fix.** Write the smallest change that turns the test green. No
   speculative extras, no refactor riding along.
3. **Refactor.** Now that it is green and locked, clean it up. The test keeps
   you honest.
4. **Ship the regression test with the fix**, in the same PR. A fix without the
   test that would have caught it does not merge.

No fix ships without a test that would have caught it. This is the rule that
keeps AI-generated volume reviewable: shared patterns plus evals as gates plus
ownership boundaries are the only thing that stops "impossible to review, pure
slop".

## Sentry and user issues are always test-first

When the signal is a Sentry exception or a user report ("price compare crashed
on a big cart", "swap gave me a dish I'm allergic to"), reproduce it as a test
before fixing. The `/shopping` 1101 became `chunkLines` / `mergeChunkBaskets`
tests that lock the bound (ADR-0005). That is the model: the test encodes the
exact failure so it can never come back silently.

## The gate already locks behaviour

`pnpm quality` (and the pre-push hook) runs the full gate. These are part of it,
so a regression fails the push, not code review:

- **The three cart invariants.** AH-URL faithfulness (the cart link resolves to
  exactly the SKUs we picked), grams (quantities are real and consistent), and
  ingredients-to-recipes (every cart line traces to a grounded recipe).
- **The matcher eval** (`pnpm eval`, 16 golden cases, 80% threshold, runs when
  matcher files change), the **replan-agent eval** (grounded recipes, no
  hallucinated names, honest decline), the **memory-classifier eval**, and the
  **recall benchmark gate** (ADR-0002). Full map: `docs/adr/0006`.

When you add an AI behaviour, add the eval case that locks it (a golden case, a
reject case, a scorer). When you fix an AI bug, add the case that reproduces it.
The eval _is_ the regression test for AI behaviour.

## Anti-patterns

- Fixing first and adding a test "to be safe" after. The test must fail first or
  it proves nothing.
- A test that asserts the new behaviour but would also have passed before the
  fix. That is not a regression test.
- Skipping the eval case for an AI change because "the unit tests pass". Unit
  tests do not catch a worse rerank or a lower recall; the evals and the recall
  gate do.
