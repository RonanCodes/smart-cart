---
name: bounded-ai-on-request-paths
description: The /shopping 1101 lesson. Any AI or heavy work on a request path must be bounded, batched, or chunked, because Cloudflare Workers have a hard ~128MB memory and a CPU cap and D1 has query/subrequest limits. "Fans out per-item over a big input" is a memory/CPU risk; chunk it and degrade, never crash. Read before adding any matcher, embedding, or per-item loop to a server fn or loader.
---

# Bound AI work on request paths

This is the lesson that bit twice. Read it before you put any AI call, embedding,
or per-item loop on a path that serves a request.

## The ceiling is real and hard

A Cloudflare Worker isolate has a hard ~128 MB memory cap and a CPU cap. D1 has
query and subrequest limits. When an isolate exceeds the cap, Cloudflare kills it
and the whole request returns a **1101**. There is no graceful OOM; the request
dies.

## What bit us

- **It was flagged early.** When the embeddings plan was pressure-tested, Opus
  warned the vectors "would blow up D1 worker size". A pre-mortem on the plan
  caught a real ceiling before it shipped.
- **It still caused a prod outage.** The Cart screen's `usePriceComparison` hook
  fanned out one `comparePriceForStore` call per store, each carrying _every_
  line of the cart. The accurate-tier matcher (embed + multi-query retrieve +
  LLM rerank per uncached line, against the ~4 MB in-memory catalogue) then
  resolved N lines in one isolate. A big cart blew the 128 MB / CPU cap, the
  isolate was killed, and `/shopping` returned a **1101** that got worse the more
  ingredients the cart had. (`PER_STORE_CAP=400` silently cutting flour rows was
  the same family of bug: an unbounded input meeting a hard limit.)

## The rule

**Anything that fans out per-item over a big input is a memory/CPU risk.** Treat
it as one from the start. Before you add an AI call or a heavy loop to a request
path:

1. **Bound it.** Cap the number of items processed in a single isolate
   invocation. `PRICE_COMPARE_CHUNK_SIZE = 25` is the canonical example.
2. **Chunk it.** Split the input into fixed-size chunks and run one invocation
   per chunk, so no single isolate ever processes more than the cap. An ordinary
   input that fits in one chunk pays no extra round-trips.
3. **Batch and share.** Batch embeddings across lines, cache by normalized text,
   share in-flight promises across concurrent calls (#479, #481). Do not re-pay
   identical work per store.
4. **Degrade, never throw.** A chunk that overruns or errors degrades to a
   `null` partial result (logged structured, e.g. `price_compare.chunk_degraded`)
   instead of bubbling. The request still completes from the chunks that
   resolved. A failure is surfaced only when _nothing_ succeeded. A failed
   compare can never reach a full-page error.

## The canonical fix (#482)

The `/shopping` 1101 was fixed entirely at the call-site, with no matcher
internals touched:

- `chunkLines` (pure): split the cart's lines into chunks of 25, fan one
  `comparePriceForStore` call per chunk per store.
- `mergeChunkBaskets` (pure): recombine per-chunk partial baskets into one
  per-store basket (sum totals, concat line items / unavailable / waste).
- A degraded chunk returns `null`, logged structured; the store still totals from
  what resolved; a store whose every chunk failed is dropped.

Both helpers are pure and unit-tested, so the bound is locked by tests (see
`reproduce-first-tdd`). Full reasoning: `docs/adr/0005`.

## Where to put the bound

At the **call-site**, not inside the matcher. The matcher, `src/lib/pricing/*`,
and cart-build are Nic's (see `ship-flow-and-ownership`). You bound how much you
hand it per invocation; you do not change how it resolves a line.
