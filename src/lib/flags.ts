/**
 * Feature flags: the single source of truth for which dodgy-but-shippable
 * features are live. Pure + client-safe (no DB / cloudflare:workers import), so
 * it can be imported anywhere — the components, the server fns, and the tests.
 *
 * The VALUES come from D1 at runtime (flags-server.ts reads the feature_flag
 * table, mirroring the launch_state pattern) and are bootstrapped to the client
 * once via the root loader (flags-context.tsx). This file only owns the KEYS,
 * the hardcoded SAFE DEFAULTS, and the pure predicates that read a FlagSet.
 *
 * Two store capabilities are flagged INDEPENDENTLY per store:
 *  - `visible`  — the store is selectable in the pickers and priced in the cart.
 *  - `ordering` — the store can actually receive a cart ("Order at <store>").
 * They're separate because Picnic is priced today but its cart isn't wired
 * (#293): visible but not orderable. `tipping` gates the optional tip-on-add.
 *
 * The DEFAULTS are the conservative prod fallback used whenever D1 is empty or
 * unreachable, so a missing row / failed read NEVER opens a feature — it lands
 * on this table. Per-environment values live in each environment's own D1
 * (smart_cart_db vs smart_cart_db_dev), so dev can turn Jumbo on without
 * touching prod.
 */

import type { StoreSlug } from './store-pref-server'

export const FLAG_KEYS = [
  'store.ah.visible',
  'store.ah.ordering',
  'store.jumbo.visible',
  'store.jumbo.ordering',
  'store.picnic.visible',
  'store.picnic.ordering',
  'tipping',
] as const

export type FlagKey = (typeof FLAG_KEYS)[number]

/** The resolved on/off state of every flag. */
export type FlagSet = Record<FlagKey, boolean>

/**
 * The safe fallback every flag lands on when D1 has no row for it (empty table,
 * failed read, migration not yet applied). Conservative on purpose: an unknown
 * state must never turn a feature ON.
 *  - AH: the wired, tested store — visible + orderable.
 *  - Jumbo: parked — off / off (flip ON in the dev D1 to test, prod stays off).
 *  - Picnic: priced but its cart isn't built (#293) — visible, not orderable.
 *  - tipping: on (the established behaviour), flip off if it misbehaves.
 */
export const FLAG_DEFAULTS: FlagSet = {
  'store.ah.visible': true,
  'store.ah.ordering': true,
  'store.jumbo.visible': false,
  'store.jumbo.ordering': false,
  'store.picnic.visible': true,
  'store.picnic.ordering': false,
  tipping: true,
}

/** Narrow an arbitrary string to a known flag key. */
export function isFlagKey(key: string): key is FlagKey {
  return (FLAG_KEYS as ReadonlyArray<string>).includes(key)
}

/**
 * Overlay a partial set of flag values (e.g. the rows present in D1) on top of
 * the hardcoded defaults, so every key is always defined. Pure: unknown keys are
 * ignored and any non-boolean is coerced, so junk in the table can never throw
 * out of a request path or flip a flag to an undefined state. Unit-tested.
 */
export function mergeFlags(
  partial: Partial<Record<string, unknown>> | null | undefined,
): FlagSet {
  const out: FlagSet = { ...FLAG_DEFAULTS }
  if (!partial) return out
  for (const key of FLAG_KEYS) {
    const v = partial[key]
    if (typeof v === 'boolean') out[key] = v
  }
  return out
}

/** Whether a store is selectable in the pickers + priced in the cart. */
export function storeVisible(flags: FlagSet, slug: StoreSlug): boolean {
  return flags[`store.${slug}.visible`]
}

/** Whether a store can actually receive a cart ("Order at <store>"). */
export function storeOrderable(flags: FlagSet, slug: StoreSlug): boolean {
  return flags[`store.${slug}.ordering`]
}

/** A flag, shaped for the admin toggle panel (label + grouping + help text). */
export interface FlagMeta {
  key: FlagKey
  /** Group heading the toggle sits under in the admin panel. */
  group: string
  /** The row label. */
  label: string
  /** One-line help shown under the label. */
  description: string
}

/**
 * Admin-panel metadata for every flag, in display order. Drives the FlagsPanel
 * so the toggle UI stays in lock-step with FLAG_KEYS (a new key without a meta
 * entry is a type error). Grouped by store, then checkout.
 */
export const FLAG_META: ReadonlyArray<FlagMeta> = [
  {
    key: 'store.ah.visible',
    group: 'Albert Heijn',
    label: 'Selectable + priced',
    description: 'Show Albert Heijn in the store pickers and price the cart.',
  },
  {
    key: 'store.ah.ordering',
    group: 'Albert Heijn',
    label: 'Ordering',
    description: 'Allow sending a cart to Albert Heijn.',
  },
  {
    key: 'store.jumbo.visible',
    group: 'Jumbo',
    label: 'Selectable + priced',
    description: 'Show Jumbo in the store pickers and price the cart.',
  },
  {
    key: 'store.jumbo.ordering',
    group: 'Jumbo',
    label: 'Ordering',
    description: 'Allow sending a cart to Jumbo.',
  },
  {
    key: 'store.picnic.visible',
    group: 'Picnic',
    label: 'Selectable + priced',
    description: 'Show Picnic in the store pickers and price the cart.',
  },
  {
    key: 'store.picnic.ordering',
    group: 'Picnic',
    label: 'Ordering',
    description: "Allow sending a cart to Picnic (its cart isn't wired yet).",
  },
  {
    key: 'tipping',
    group: 'Checkout',
    label: 'Tipping',
    description: 'Show the optional tip prompt when a cart is sent.',
  },
]

/** The ordering-capability flag keys, for the "disable all ordering" action. */
export const ORDERING_FLAG_KEYS: ReadonlyArray<FlagKey> = FLAG_KEYS.filter(
  (k) => k.endsWith('.ordering'),
)
