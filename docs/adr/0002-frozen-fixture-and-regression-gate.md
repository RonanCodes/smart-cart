# ADR-0002: Frozen benchmark fixture + hard regression gate on recall

- **Status**: accepted
- **Date**: 2026-06-19

## Context

The swipe recommenders (`src/lib/recsys/strategies.ts`) are scored by a benchmark that
simulates onboarding over synthetic users and measures recall@20 against each user's
true top-20. The adaptive recommender is the production winner. The risk: a future
change to a ranker, the ground-truth, or the embedding could quietly lower recall and
no one would notice, because the benchmark is a script someone has to remember to run.

Two things make a gate possible. First, the benchmark inputs were frozen into a
versioned fixture (`data/fixtures/benchmark/v1/`: catalogue + synthetic users + RNG
seed) in slices #37 and #38, so the benchmark is fully deterministic with no DB and no
network. Second, the benchmark is pure set-maths, so the same numbers come out every
run on the same code.

## Decision

Freeze the benchmark fixture (already done) and **hard-gate recall** in CI.

- Commit `docs/benchmarks/baseline.json`: per algorithm, recall@20 at the 20- and
  30-swipe checkpoints plus median swipes-to-target, with an absolute `tolerance` of
  `0.02` (2 recall points, because real-catalogue recall is modest, e.g. adaptive
  ~0.16 recall@20 at 30 swipes).
- Add `src/lib/recsys/benchmark.guard.test.ts`. It recomputes the benchmark on the
  frozen fixture and FAILS if any algorithm's recall at any baselined checkpoint drops
  below `baseline - tolerance`. One assertion per algorithm so a RED gate names the
  culprit.
- The benchmark math lives in one shared module (`src/lib/recsys/benchmark-core.ts`)
  used by both the script and the guard test, so "the benchmark" means the same thing
  in the report and in the gate.
- The guard is a normal `*.test.ts`, so `vitest run` picks it up and it runs inside
  `pnpm quality` and the pre-push hook with no extra wiring.

Refreshing the baseline is a deliberate act: re-run `pnpm benchmark`, regenerate
`baseline.json`, and record the intent in the PR. The gate only catches _silent_
regressions, not intentional baseline moves.

## Consequences

- No ranker / ground-truth / embedding change can silently regress recall: a drop past
  the tolerance turns the local CI red before it can merge.
- The guard is offline and deterministic (reads the committed fixture, never live D1 or
  Vectorize), so it is reproducible on any machine and in CI.
- It is not free: recomputing the benchmark over 1531 recipes x 300 users takes roughly
  one to two minutes inside `pnpm test`. That is the cost of a real accuracy gate; it
  stays well inside the local pre-push budget. If it ever dominates, sub-sample the
  fixture users into a `v-fast` variant and re-baseline against that.
- The tolerance is a tuning knob. Too tight and noise-free-but-legitimate refactors go
  red; too loose and small regressions slip through. `0.02` absolute is a deliberate
  starting point given recall is in the 0.04 to 0.16 range; revisit if it proves flaky.
- A deliberate accuracy improvement still requires regenerating the baseline, otherwise
  the gate stays pinned to the old (lower) numbers. That is acceptable: an improvement
  that is not re-baselined simply leaves head-room, it never fails the build.
