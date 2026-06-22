# ADR-0005: Bound AI / heavy work on request paths (the 1101 lesson)

- **Status**: accepted
- **Date**: 2026-06-22

## Context

The semantic matchers (ADR-0004) are heavy: the accurate-tier ingredient-to-SKU
path embeds, runs multi-query retrieval, and LLM-reranks per uncached line,
against the ~4 MB in-memory checkjebon catalogue. That cost is fine for one line.
It is not fine when an isolate is handed an unbounded number of lines at once.

A Cloudflare Worker isolate has a hard **~128 MB memory cap and a CPU cap**, and
D1 has query/subrequest limits. There is no graceful out-of-memory: when an
isolate exceeds the cap, Cloudflare kills it and the request returns a **1101**.

This ceiling was flagged before the matcher shipped. When the embeddings plan was
pressure-tested, a strong model (Opus) warned the vectors "would blow up D1
worker size". A pre-mortem on the plan caught a real ceiling. It still bit in
production, twice in the same family:

1. `PER_STORE_CAP=400` silently truncated product rows (cutting `tarwebloem`
   noise), an unbounded input meeting a hard limit by quietly dropping data.
2. The Cart screen's `usePriceComparison` hook fanned out one
   `comparePriceForStore` call **per store, each carrying every line of the
   cart**. A single isolate then resolved N lines through the accurate matcher,
   blew the 128 MB / CPU cap, was killed, and `/shopping` returned a **1101**
   that got worse the more ingredients the cart had. The `/shopping` SSR loader
   itself only did cheap DB reads; the blow-up was the per-store fan-out over a
   big cart, which is why it was cart-size-dependent and `/shopping`-specific.

The general failure: **anything that fans out per-item over a big input is a
memory/CPU risk.** AI work makes it worse because each item is expensive, but the
shape (unbounded fan-out in one isolate) is the bug.

## Decision

**Any AI or heavy work on a request path must be bounded, batched, or chunked,
and must degrade rather than crash.** Concretely:

1. **Bound the fan-out.** Cap how many items a single isolate invocation
   processes. `PRICE_COMPARE_CHUNK_SIZE = 25` is the canonical cap.
2. **Chunk over the cap.** Split the input into fixed-size chunks and run one
   invocation per chunk, so no isolate ever processes more than the cap. An input
   that fits in one chunk pays no extra round-trips (an ordinary week's cart stays
   a single chunk).
3. **Batch and share work.** Batch embeddings across lines, cache by normalized
   query text, and share in-flight promises across concurrent calls so N stores
   do not each re-pay identical embedding/expansion work (ADR-0004 consequences;
   PRs #479, #481).
4. **Degrade, never throw.** A chunk that overruns or errors degrades to a `null`
   partial result, logged structured (`price_compare.chunk_degraded`), instead of
   bubbling. The request completes from the chunks that resolved; a failure is
   surfaced only when nothing succeeded. A failed compare can never reach a
   full-page error.

**Fix at the call-site, not inside the matcher.** The #482 fix touched no matcher
internals (ADR-0004 stays owned and locked). It added two pure, unit-tested
helpers at the call-site:

- `chunkLines`: split the cart's lines into chunks of 25; fan one
  `comparePriceForStore` call per chunk per store.
- `mergeChunkBaskets`: recombine per-chunk partial baskets into one per-store
  basket (sum totals, concat line items / unavailable / waste).

Because both helpers are pure, the bound is locked by tests, per the repo's
reproduce-first TDD rule: the 1101 became a regression test before the fix.

## Consequences

- A big cart no longer 1101s; it resolves in bounded chunks and degrades
  gracefully if a chunk overruns, rather than killing the whole request.
- The bound is a tuning knob. 25 lines per chunk is a deliberate starting point
  below the observed ceiling; if the accurate tier gets heavier or lighter,
  re-tune the cap (and re-baseline the chunk tests), do not remove it.
- This rule is now general: before adding any AI call or heavy per-item loop to a
  server fn or loader, bound/batch/chunk it and make it degrade. "This fans out
  per-item over a big input" is treated as a memory/CPU risk from the start, not
  after the first 1101.
- The pre-mortem habit (validate the plan with a strong model before building)
  earned its place: it named this exact ceiling. The gap was acting on the
  warning at every fan-out, not just where the warning was first raised.

## Evidence

PR #482 (chunk `/shopping` price compare to 25 lines, degrade per chunk); the
earlier `PER_STORE_CAP` truncation; the batch/share work in #479 and #481. Skill:
`.claude/skills/bounded-ai-on-request-paths/`.
