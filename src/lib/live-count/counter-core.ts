/**
 * Pure, worker-agnostic logic for the live user counter. No Cloudflare or DOM
 * imports here so it is trivially unit-testable and safe to reason about; the
 * Durable Object (counter-do.ts) and the client (Landing.tsx) both lean on these
 * helpers for the count maths and the wire shape.
 *
 * The counter is monotonic by intent: a "N home cooks" number on the landing
 * should only ever go UP as people sign up. So when a new absolute count arrives
 * we keep the larger of the two (guards against a stale/racing seed POST
 * clobbering a higher live value, and against a negative or garbage payload).
 */

/** The message shape broadcast over the WebSocket and accepted on POST. */
export interface CountMessage {
  count: number
}

/** A POST body may set an absolute `count` or apply a relative `delta`. */
export interface CountUpdate {
  count?: unknown
  delta?: unknown
}

/** Coerce an unknown into a finite, non-negative integer, or null if it cannot. */
export function toCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  const floored = Math.floor(n)
  return floored >= 0 ? floored : null
}

/**
 * Given the currently-stored count and an update, return the next count to
 * store. Monotonic: never decreases. An absolute `count` is taken as the max of
 * current and the new value; a `delta` is added (and clamped at 0). A garbage
 * update leaves the current value unchanged.
 */
export function nextCount(current: number, update: CountUpdate): number {
  const base = toCount(current) ?? 0
  if (update.count !== undefined) {
    const incoming = toCount(update.count)
    if (incoming === null) return base
    return Math.max(base, incoming)
  }
  if (update.delta !== undefined) {
    const d =
      typeof update.delta === 'number' ? update.delta : Number(update.delta)
    if (!Number.isFinite(d)) return base
    return Math.max(0, base + Math.floor(d))
  }
  return base
}

/** Shape the broadcast/initial-send payload for a given count. */
export function countMessage(count: number): CountMessage {
  return { count: toCount(count) ?? 0 }
}

/** Serialise a count to the exact JSON string sent over the socket. */
export function serializeCount(count: number): string {
  return JSON.stringify(countMessage(count))
}

/**
 * Parse an inbound WebSocket / POST body into a CountUpdate. Returns null for
 * anything that is not a usable update so callers can ignore noise safely.
 */
export function parseUpdate(
  raw: string | null | undefined,
): CountUpdate | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as CountUpdate
  if (obj.count === undefined && obj.delta === undefined) return null
  return obj
}
