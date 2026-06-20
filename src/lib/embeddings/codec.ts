/**
 * Pure vector codec + brute-force top-K. No I/O, no binding, so it is unit-tested
 * directly and runs identically in Node (the embed script) and the Worker.
 *
 * Encoding: Float32 -> base64. 256 floats = 1 KB binary (~1.4 KB base64) versus
 * ~4.6 KB as a JSON number array, so the committed index and the D1 blob columns
 * stay small (ADR-0004). btoa/atob are global in both Workers and Node 18+.
 */

import { cosineSimilarity } from 'ai'

/** Encode a vector to base64 (Float32 little-endian). */
export function encodeVector(
  values: ReadonlyArray<number> | Float32Array,
): string {
  const f32 =
    values instanceof Float32Array ? values : Float32Array.from(values)
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** Decode a base64 Float32 vector back to a plain number array. */
export function decodeVector(b64: string): Array<number> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const f32 = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / 4,
  )
  return Array.from(f32)
}

/** A vector with an id, the unit of the in-memory index. */
export interface VectorEntry {
  id: string
  vector: Array<number>
}

/** A scored hit: an entry id and its cosine similarity to the query (0..1-ish). */
export interface ScoredHit {
  id: string
  score: number
}

/**
 * Brute-force top-K by cosine similarity. At this catalogue size (~5k products,
 * ~1.5k recipes) a linear scan is sub-5ms, so no ANN index is needed (ADR-0004).
 * Uses the AI SDK's `cosineSimilarity` so the maths is shared, not re-derived.
 */
export function topK(
  query: ReadonlyArray<number>,
  entries: ReadonlyArray<VectorEntry>,
  k: number,
): Array<ScoredHit> {
  const q = query as Array<number>
  const scored: Array<ScoredHit> = []
  for (const e of entries) {
    scored.push({ id: e.id, score: cosineSimilarity(q, e.vector) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}
