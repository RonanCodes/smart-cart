# ADR-0006: Evals + Braintrust tracing as gates on AI behaviour

- **Status**: accepted
- **Date**: 2026-06-22
- **Relates to**: ADR-0002 (the recall benchmark gate, the first instance of this
  pattern), ADR-0004 (the matchers being gated)

## Context

ADR-0002 hard-gated the preference recommender on Recall@20 against a frozen
fixture, so a ranker change could not silently lower recall. That solved one
path. The rest of the AI surface had the same exposure: a worse SKU rerank, a
replan agent that starts naming hallucinated dishes, a memory classifier that
mislabels a fact: all are silent quality regressions that unit tests do not
catch and that are invisible in code review, especially when the volume is
AI-generated. "AI-generated volume is impossible to review, pure slop" without
shared patterns plus evals as gates plus ownership boundaries.

Unit tests check that code runs. They do not check that an LLM still makes the
right decision or that recall did not drop two points. That needs evals, and
evals only protect anything if they run in the gate and a regression turns it
red.

## Decision

**Trace every AI call to Braintrust, and gate AI behaviour with evals that run in
`pnpm quality` / the pre-push hook.**

### Tracing

`src/lib/braintrust-ai.ts` wraps the Vercel AI SDK with Braintrust's
`wrapAISDK()` under project "Smart Cart". Every `generateObject`, `embed`, and
`embedMany` made through it traces automatically: spans, inputs, outputs, and
eval scores, with named child spans (`expand-ingredient`, `embed-search-terms`,
`rerank-sku`). It runs `asyncFlush: false` because Cloudflare Workers has no
Vercel `waitUntil` to flush on; flush explicitly before the request ends. So
embeddings, SKU reranks, and agent runs are inspectable after the fact, not a
black box, and LLM fallbacks/decisions surface in the admin panel.

### The evals (the gates)

Four evals cover the AI surface. The principle: "create evals to verify it does
what we expect", and wire them so a regression fails the push.

1. **Matcher eval** (`scripts/eval.ts`, `pnpm eval`). The real ingredient-to-SKU
   pipeline (expand, embed, cosine retrieve, LLM rerank) over 16 golden cases
   against Albert Heijn. Eight cross-language/staple cases (mushroom to
   champignon, "00 flour" to bloem/meel); eight real cart failures with reject
   filters that lock the fixes ("chilli flakes" must not match Doritos, "almond
   flour" must reject cake/taart/koek). Pass threshold 80%. Wired into the
   pre-push hook but runs only when matcher files change, so a docs push never
   pays for it. Every embed and rerank traces to Braintrust.
2. **Replan-agent eval** (`evals/replan-agent.eval.ts`,
   `pnpm eval:replan-agent`). 23 tasks across skip/swap/exclude/lean-more/
   quicker/add-meal/regenerate/read-only/compound/ambiguous. 15 scorers
   (`src/lib/agent/eval/scorers.ts`) lock behaviour, including the trust-critical
   ones: `groundedRecipes` (every landed recipe exists in the catalogue),
   `noRecipeNamesInMessage` + `toolArgsAreConstraints` (anti-hallucination: the
   model names constraints, never dishes or recipe ids), `honestDecline` (when
   nothing can be done, the message declines and the week does not change), plus
   `dietRespected` and the rest.
3. **Memory-classifier eval** (`pnpm eval:memory-classifier`). A Braintrust
   dataset checking a spoken/typed fact maps to the right memory `kind` and
   polarity.
4. **Recall benchmark gate** (ADR-0002, vitest guard in `pnpm quality`). The
   preference recommender gated on Recall@20 against the frozen fixture in
   `data/fixtures/benchmark/v1/`; a drop past 0.02 below
   `docs/benchmarks/baseline.json` fails the guard and names the algorithm.

### Run locally, deterministic where it can be

Evals run **locally** in the gate; the hosted Braintrust free quota blows up if
they run on every CI push. The matcher and agent evals exercise the real LLM
path, so they are gated on the relevant files changing. The recall gate is fully
deterministic and offline (frozen fixture, no DB, no network), so it runs every
time inside `pnpm test`.

## Consequences

- A worse rerank, a hallucinating replan agent, a mislabelled memory, or a
  recall drop turns the local gate red before merge, not after a user hits it.
- Refreshing a baseline (recall) or a golden set (matcher/agent) is a deliberate
  act recorded in the PR. The gates catch silent regressions, not intentional
  moves.
- Every AI decision is traceable in Braintrust, so debugging a bad pick starts
  from the actual span and inputs, not a guess.
- Tracing must never crash a request: the Braintrust wrapper and flush are
  best-effort and caught, never propagated into the request path.

## Evidence

PRs #261, #278, #477, #479, #481 (the matcher and agent evals built alongside the
features), #478 (fail-closed secrets the safety evals assume). ADR-0002 (the
recall gate). Skills: `.claude/skills/ai-safe-and-fast/`,
`.claude/skills/reproduce-first-tdd/`.
