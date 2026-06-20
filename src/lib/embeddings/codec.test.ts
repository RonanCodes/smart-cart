import { describe, expect, it } from 'vitest'
import { decodeVector, encodeVector, topK } from './codec'

describe('vector codec', () => {
  it('round-trips a vector through base64 (Float32 precision)', () => {
    const v = [0, 1, -1, 0.5, -0.25, 0.123456]
    const decoded = decodeVector(encodeVector(v))
    expect(decoded).toHaveLength(v.length)
    decoded.forEach((x, i) => expect(x).toBeCloseTo(v[i]!, 5))
  })

  it('encodes a 256-dim vector to ~1.4 KB base64', () => {
    const v = Array.from({ length: 256 }, (_, i) => Math.sin(i))
    const b64 = encodeVector(v)
    // 256 floats * 4 bytes = 1024 bytes -> 1368 base64 chars.
    expect(b64.length).toBe(1368)
    expect(decodeVector(b64)).toHaveLength(256)
  })
})

describe('topK', () => {
  const entries = [
    { id: 'a', vector: [1, 0, 0] },
    { id: 'b', vector: [0, 1, 0] },
    { id: 'c', vector: [0.9, 0.1, 0] },
  ]

  it('ranks nearest first by cosine similarity', () => {
    const hits = topK([1, 0, 0], entries, 2)
    expect(hits.map((h) => h.id)).toEqual(['a', 'c'])
    expect(hits[0]!.score).toBeCloseTo(1, 5)
    expect(hits[1]!.score).toBeGreaterThan(hits[0]!.score - 1)
  })

  it('caps at k', () => {
    expect(topK([1, 0, 0], entries, 1)).toHaveLength(1)
    expect(topK([1, 0, 0], entries, 99)).toHaveLength(3)
  })
})
