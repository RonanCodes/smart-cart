# ADR-0007: Feature flags are D1-backed and per-environment

- **Status**: accepted
- **Date**: 2026-06-24

## Context

Several user-facing features are shippable but not fully trustworthy yet, and we
need to turn them on or off per environment **without a redeploy**:

- Each store (Albert Heijn / Jumbo / Picnic) should be independently switchable
  between "selectable + priced" and "can actually receive a cart". Picnic is
  priced today but its cart isn't wired (#293), so those two capabilities can't
  be one flag.
- Ordering and tipping are dodgy enough that we want kill-switches if Mollie or a
  store cart-link misbehaves.
- Dev and prod must be independent: we want to enable Jumbo on dev.souso.app to
  test it while prod stays on the safe defaults.

The flag checks land on the SSR / request path (`canOrder` on the order bar,
store availability in the pickers, the tip prompt), so flag evaluation must be
instant and must never block or crash a render (ADR-0005, and the repo's
"observability must never crash a request" rule).

## Decision

**Feature flags are stored one-row-per-key in a D1 `feature_flag` table, read
per request and degrading to hardcoded safe defaults, with values scoped to each
environment's own database.**

- **Backing store: D1**, mirroring the existing `launch_state` / `payment_mode` /
  `data_mode` runtime-toggle pattern. No new infrastructure, and D1 is already
  bound per-environment (`smart_cart_db` for prod, `smart_cart_db_dev` for dev),
  so per-environment independence is free: toggling on dev.souso.app writes the
  dev DB, souso.app writes the prod DB.
- **Safe-default-closed.** `FLAG_DEFAULTS` (in `lib/flags.ts`) is the conservative
  fallback used whenever D1 is empty, the row is missing, or the read fails. A
  missing/unknown state never opens a feature. Current defaults: AH on, Jumbo
  off, Picnic visible-not-orderable, tipping on.
- **Two capabilities per store, flagged independently:** `store.<slug>.visible`
  (selectable + priced) and `store.<slug>.ordering` (can receive a cart). Plus a
  global `tipping` flag.
- **Request-path-safe read.** `lib/flags-read.ts` does the D1 read and is reached
  ONLY via dynamic `import()` inside server-fn handlers, so its transitive
  `db/client` (which imports `cloudflare:workers`) never enters the client
  bundle. It catches everything and returns `FLAG_DEFAULTS` on any error, so it
  can sit in the root loader (which runs on every page, including the public
  landing) without ever throwing.
- **Bootstrapped to the client once.** The root loader resolves the `FlagSet` and
  hands it to `FlagsProvider`; components read it via `useFlags()` synchronously,
  no async work on the render path, no flicker.
- **Gated at call-sites, not in owned internals.** Store pickers,
  `effectiveStore`/`setStore`, `FloatingOrderBar.canOrder`, and the tip prompt
  read flags. The matcher/cart/Mollie internals are untouched (Nic-owned). The
  `startTip` handler carries a defence-in-depth flag check so a stale client
  can't start a charge while tipping is off.
- **Admin toggle** at `/admin/flags` (admin-gated `setFlags` upsert) with a
  "disable all ordering" master button.

### Alternatives considered and rejected

- **PostHog feature flags.** It's a real flag tool, but here PostHog is
  client-side only and gated to `import.meta.env.PROD` (doesn't run in dev), with
  no server client. Making it work would mean a server client + SSR bootstrapping
  - relaxing the dev gate, and a single PostHog project makes a flag project-wide,
    so per-environment independence would have to be faked with separate keys or
    release conditions. Wrong shape for instant per-env kill-switches.
- **Cloudflare KV.** Viable and per-env, but it's new infrastructure for no gain
  over D1, which we already bind per-environment and already use for exactly this
  runtime-toggle pattern.
- **Sentry.** Not a flag provider; it only records flag evaluations made by other
  providers. Ruled out.
- **Plain env vars in wrangler.jsonc.** Per-env, but flipping a flag needs a
  redeploy. The requirement was instant toggling, so this fails the brief.

## Consequences

- Flag values are independent per environment with zero extra config; dev can run
  Jumbo on while prod stays conservative.
- A new flag is added in one place (`FLAG_KEYS` + `FLAG_DEFAULTS` + `FLAG_META`),
  and every call-site reads it through the same pure predicates, so the toggle UI
  and the gates stay in lock-step (a key without a meta entry is a type error).
- Because the backing store is isolated behind `lib/flags-read.ts` and the call
  sites read a plain `FlagSet`, the source could later become PostHog (for
  per-user targeting / % rollouts) without touching call-sites, if that need ever
  arises. We don't need it now.
- Flags are global on/off, not per-user. Per-user targeting is explicitly out of
  scope.

## Evidence

PR #527 (`feature_flag` table + `lib/flags*`, admin `/admin/flags`, store/order/
tip call-site gating; also dropped the Picnic sticker joke and set 30-day rolling
sessions). Migration `0028_feature_flag`.
