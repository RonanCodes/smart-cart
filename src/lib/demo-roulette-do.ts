import { DurableObject } from 'cloudflare:workers'

/**
 * The ephemeral entrant store for the live-pitch roulette demo.
 *
 * CRITICAL PRIVACY PROPERTY: the phone numbers entered on the public join page
 * are held ONLY in this Durable Object's in-memory `entrants` array. They are
 * NEVER written to D1/Drizzle, never logged, and never returned to any client.
 * `count()` returns only an integer; `spin()` returns only a masked label plus
 * the single picked number (which the server hands straight to VAPI and then
 * forgets). `clear()` wipes the list. When the DO evicts (idle) the numbers are
 * gone too — there is no `state.storage` persistence on purpose, so this is
 * truly "nowhere": no disk, no database, no durable storage key.
 *
 * One global room: every request routes to the same named DO instance
 * (`idFromName('live')`), so all entrants land in one draw.
 */
export class DemoRouletteRoom extends DurableObject {
  /** In-memory only. Deliberately NOT backed by this.ctx.storage. */
  private entrants: Array<string> = []

  /** Add a normalised number to the draw. De-duplicates so one phone = one
   * entry. Returns the new count (never the numbers). */
  add(normalised: string): number {
    if (!this.entrants.includes(normalised)) {
      this.entrants.push(normalised)
    }
    return this.entrants.length
  }

  /** How many entrants are in the draw. The ONLY number any client ever sees. */
  count(): number {
    return this.entrants.length
  }

  /**
   * Pick one uniformly-random entrant. Returns the raw number (server-only, for
   * the VAPI dispatch) — callers must NEVER forward this to a browser. Returns
   * null on an empty draw.
   */
  spin(): { phone: string; total: number } | null {
    const n = this.entrants.length
    if (n === 0) return null
    // Inline unbiased pick (the DO can't import the pure helper without pulling
    // it into this module's graph, which is fine, but keeping it inline keeps
    // the DO self-contained).
    const max = Math.floor(0xffffffff / n) * n
    const buf = new Uint32Array(1)
    let value: number
    do {
      crypto.getRandomValues(buf)
      value = buf[0]!
    } while (value >= max)
    const idx = value % n
    return { phone: this.entrants[idx]!, total: n }
  }

  /** Wipe every entrant. Used by the presenter "clear" action and after a run. */
  clear(): number {
    this.entrants = []
    return 0
  }
}
