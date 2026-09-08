/**
 * Pure helpers for the live-pitch roulette demo (no DB, no env, no Worker
 * binding), so they can be unit-tested in isolation. The phone numbers entered
 * on the public join page live ONLY in an in-memory Durable Object for the
 * length of the pitch — these helpers shape them on the way in and mask them on
 * the way out so a raw number never leaves the server.
 */

/**
 * Normalise a phone number to E.164-ish digits for dialling: strip everything
 * but digits and a single leading `+`. A Dutch-first heuristic turns a local
 * `06...` mobile into `+316...` so presenters can type the number the way it's
 * spoken on stage. Returns `null` for anything too short to be a real number.
 *
 * This is deliberately lenient (it's a party trick, not a billing system): the
 * VAPI outbound call is the real validator — a malformed number simply fails to
 * connect.
 */
export function normalisePhone(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Keep a leading +, drop all other non-digits.
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length < 6) return null

  if (hasPlus) return `+${digits}`

  // Dutch local mobile: 06xxxxxxxx -> +316xxxxxxxx.
  if (digits.startsWith('06') && digits.length === 10) {
    return `+31${digits.slice(1)}`
  }
  // Dutch with country code but no +: 31...
  if (digits.startsWith('31')) return `+${digits}`

  // Otherwise assume the user typed full international digits without the +.
  return `+${digits}`
}

/**
 * Mask a number for the on-stage animation: reveal only the last two digits,
 * everything else becomes a dot. e.g. `+31612345689` -> `•••• ••89`. Never
 * returns enough to identify the entrant, only enough to make the reveal feel
 * real.
 */
export function maskPhone(normalised: string): string {
  const digits = normalised.replace(/\D/g, '')
  const last2 = digits.slice(-2).padStart(2, '•')
  return `•••• ••${last2}`
}

/**
 * Pick a uniformly-random index into a list of `length` entrants using
 * `crypto.getRandomValues` (Workers-safe), with rejection sampling so the
 * modulo is unbiased. Returns -1 for an empty list.
 */
export function pickRandomIndex(length: number): number {
  if (length <= 0) return -1
  if (length === 1) return 0
  const max = Math.floor(0xffffffff / length) * length
  const buf = new Uint32Array(1)
  // Rejection-sample to avoid modulo bias on the tail of the uint32 range.
  let value: number
  do {
    crypto.getRandomValues(buf)
    value = buf[0]!
  } while (value >= max)
  return value % length
}
