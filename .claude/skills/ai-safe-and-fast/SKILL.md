---
name: ai-safe-and-fast
description: The core thesis for every AI feature in Souso. Embeddings for multilingual matching (never synonym/heuristic maps), an LLM only at decision points, deterministic for anything that must be reproducible, embeddings pre-computed offline. Then make it safe (fail-closed, deterministic hard filters, conservative rerank, wrong-type guards, soft penalties), fast (tiered cheap-to-accurate, batch + cache + share), and verifiable (Braintrust traces + evals as gates). Read before adding or changing any matcher, embedding, rerank, or LLM call.
---

# AI: safe, fast, verifiable

This is how Souso does AI. It comes from the matcher work (Nic's PRs #261, #278,
#477, #479, #481) and is the rule, not a suggestion. The full record is
`docs/ai-architecture.md` and `docs/adr/0004` (matching), `docs/adr/0005`
(bounded request paths), `docs/adr/0006` (evals + tracing as gates).

## The core thesis

Pick the right tool per job. There are exactly three shapes.

1. **Embeddings for matching, not synonym/heuristic maps.** "I want something
   with mushroom" embeds and matches Dutch `champignon` and `paddenstoel` for
   free. A multilingual model (NL/EN) means you never hand-maintain a
   `mushroom: [champignon, paddenstoel]` table. Synonym maps, substring
   matching, token-overlap scoring, `CROSSLANG_EXCLUSION_GROUPS`, term-synonyms:
   these are **all the same mistake**. If you reach for one, stop and use the
   matcher. The model already knows the semantics.
2. **LLM only at decision points.** Replan intent goes LLM to structured edit
   (no regex parser). SKU choice goes top-K embedding hits to LLM rerank that
   reasons about quantity and pack size. A substitution ("00 flour instead of
   tarwebloem") goes embedding retrieve to LLM confirm. The LLM decides; it does
   not retrieve and does not invent ids.
3. **Deterministic for anything reproducible.** Week-generation ranking, hard
   allergy/diet filters, shopping-list consolidation, cart-URL building from
   resolved SKUs: set-maths, never behind an LLM. The preference recommender
   (`src/lib/recsys/`) stays set-maths and is gated on recall.
4. **Pre-compute embeddings offline.** Embed the catalogue in a script, commit
   the vectors to `data/embeddings/*`, seed into D1. Never embed the catalogue
   at request time. A cold clone plus CI reproduces every matcher with zero API
   calls. Only live user text (the replan term, the cart line) is embedded at
   runtime.

## Safe

- **Fail closed on missing secrets.** A webhook with no `VAPI_SERVER_SECRET`
  rejects; it never falls through to a `no_secret` mode (#478). Validate external
  ids (Mollie payment id shape) before using them in a path. Set explicit cookie
  attrs (httpOnly, sameSite, secure-on-HTTPS).
- **Hard filters stay deterministic.** Allergy and diet are safety constraints.
  Never trust the LLM for them. They are set-maths over rows, applied before and
  after any model call.
- **Conservative rerank thresholds.** The embedding-only fast path accepts only
  decisive winners (very high cosine, or high cosine with a clear margin).
  Anything close or type-risky goes to LLM rerank. Raw English embeddings are
  often weak: do not over-trust them (#479).
- **Wrong-type guards.** Reject Dutch compound traps: Amandelcake/-taart/-koekjes
  when you wanted almond flour, `bloem` matching bloemkool (#477). The matcher
  eval locks these as reject cases.
- **Per-user isolation** for any agent with dangerous capabilities. Never risk
  cross-user data bleed.
- **Soft penalties over hard bans for preferences** (#331). "Not pizza every
  week" down-weights repetition; it does not ban pizza. Bans are for safety only.
- **Degrade honestly, never silently.** No hidden fallback to the old token
  matcher. A missing key fails loud (replan declines with "AI adjustments off";
  price match returns `confidence: 'none'` with a visible note), because a quiet
  fallback would reintroduce the cross-language slop the embeddings removed.

## Fast

- **Tiered cheap to accurate.** Embedding-only decisive matches skip the LLM
  entirely; rerank only the ambiguous survivors.
- **Batch, cache, share** (#479, #481). Batch embeddings across all cart lines,
  not one request per line. Cache by normalized query text. Share in-flight
  promises across concurrent store comparisons so three stores do not each
  re-pay identical embedding/expansion work. An 81-line cart across stores was
  re-paying the same work per store before this.
- **Bound work per request.** Heavy per-item fan-out blows the Worker memory/CPU
  cap. See the `bounded-ai-on-request-paths` skill and ADR-0005; this is the
  lesson that caused the `/shopping` 1101.

## Verifiable

- **Braintrust traces every AI call.** `wrapAISDK` in `src/lib/braintrust-ai.ts`
  wraps the AI SDK, with named child spans (`expand-ingredient`,
  `embed-search-terms`, `rerank-sku`). It runs `asyncFlush: false` because
  Workers has no `waitUntil` to flush on.
- **Evals are gates.** The matcher eval, the replan-agent eval, the
  memory-classifier eval, and the recall benchmark gate run in `pnpm quality`
  and the pre-push hook. "Create evals to verify it does what we expect." A
  regression turns the gate red. Run them locally; the hosted free quota blows
  up otherwise. Details: `docs/adr/0006`.
- **Surface LLM decisions for inspection** in the admin panel, so a fallback or
  a wrong pick is visible after the fact, not a black box.

## When you touch AI code

Ownership: the matcher, `src/lib/pricing/*`, cart-build/cart-links, the
recipe-to-ingredient mapping, and the Mollie flow are Nic's. Work at the
call-site, not inside those internals. See `ship-flow-and-ownership`.
