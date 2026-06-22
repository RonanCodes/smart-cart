import { describe, expect, it } from 'vitest'
import {
  confidenceFromCosine,
  rerankMatch,
  selectCandidates,
  selectCandidatesFromQueries,
} from './match-semantic'
import { rerankSchema } from './rerank-sku'
import type { GenerateObjectFn, ProductCandidate } from './rerank-sku'
import type { ProductVectorEntry } from '../embeddings/store'
import type { StoreProduct } from './types'

function product(name: string, priceCents: number, slug: string): StoreProduct {
  return {
    store: 'ah',
    name,
    normalisedName: name.toLowerCase(),
    priceCents,
    slug,
    size: {
      raw: '',
      quantity: null,
      unit: null,
      dimension: 'unknown',
      approx: false,
    },
  }
}

function candidate(
  name: string,
  priceCents: number,
  slug: string,
  score: number,
): ProductCandidate {
  return { product: product(name, priceCents, slug), score }
}

const MODEL = { id: 'stub' } as never

function stubGen(object: {
  productId: string | null
  confidence: 'high' | 'medium' | 'low' | 'none'
  reason: string
}): GenerateObjectFn {
  return async () => ({ object: rerankSchema.parse(object) })
}

describe('confidenceFromCosine', () => {
  it('bands the cosine score (256-dim calibrated thresholds)', () => {
    expect(confidenceFromCosine(0.7)).toBe('high')
    expect(confidenceFromCosine(0.62)).toBe('high')
    expect(confidenceFromCosine(0.6)).toBe('medium')
    expect(confidenceFromCosine(0.55)).toBe('medium')
    expect(confidenceFromCosine(0.5)).toBe('low')
    expect(confidenceFromCosine(0.49)).toBe('none')
    expect(confidenceFromCosine(0)).toBe('none')
  })
})

describe('selectCandidates', () => {
  const entries: Array<ProductVectorEntry> = [
    { id: 'ah:champignons', store: 'ah', vector: [1, 0, 0] },
    { id: 'ah:tomaat', store: 'ah', vector: [0.5, 0.5, 0] }, // cosine ~0.71
    { id: 'ah:vaag', store: 'ah', vector: [-1, 0, 0] }, // opposite -> below floor
  ]
  const lookup = new Map<string, StoreProduct>([
    ['ah:champignons', product('AH Champignons', 149, 'champignons')],
    ['ah:tomaat', product('AH Tomaat', 99, 'tomaat')],
    ['ah:vaag', product('AH Vaag', 50, 'vaag')],
  ])

  it('ranks by cosine, drops below-floor hits, maps to products', () => {
    const cands = selectCandidates([1, 0, 0], entries, lookup, 5)
    expect(cands.map((c) => c.product.slug)).toEqual(['champignons', 'tomaat'])
    expect(cands[0]!.score).toBeCloseTo(1, 5)
  })

  it('caps at k', () => {
    expect(selectCandidates([1, 0, 0], entries, lookup, 1)).toHaveLength(1)
  })
})

describe('selectCandidatesFromQueries', () => {
  const entries: Array<ProductVectorEntry> = [
    { id: 'ah:kipgehakt', store: 'ah', vector: [0, 1, 0] },
    { id: 'ah:noodles', store: 'ah', vector: [1, 0.1, 0] },
  ]
  const lookup = new Map<string, StoreProduct>([
    ['ah:kipgehakt', product('AH Kipgehakt', 399, 'kipgehakt')],
    ['ah:noodles', product('Noodles chicken', 209, 'noodles')],
  ])

  it('merges best score per product across query vectors', () => {
    const cands = selectCandidatesFromQueries(
      [
        [1, 0.1, 0], // English query nearest noodles
        [0, 1, 0], // Dutch query nearest kipgehakt
      ],
      entries,
      lookup,
      2,
    )
    expect(cands.map((c) => c.product.slug).sort()).toEqual([
      'kipgehakt',
      'noodles',
    ])
  })
})

describe('rerankMatch (accurate tier)', () => {
  const cands = [
    candidate('AH Tomatenblokjes', 89, 'tomatenblokjes', 0.55),
    candidate('AH Champignons', 149, 'champignons', 0.5),
  ]

  it('returns no-match with no model instead of trusting raw cosine', async () => {
    const m = await rerankMatch({ name: 'mushroom' }, cands, 'ah', {})
    expect(m.match.product).toBeNull()
    expect(m.llmFallback).toBe(true)
  })

  it('uses the model-chosen product + confidence (cross-lingual)', async () => {
    const m = await rerankMatch({ name: 'mushroom' }, cands, 'ah', {
      model: MODEL,
      generateObject: stubGen({
        productId: 'champignons',
        confidence: 'high',
        reason: 'mushroom = champignon',
      }),
    })
    expect(m.match.product?.slug).toBe('champignons')
    expect(m.match.confidence).toBe('high')
    expect(m.match.estimated).toBe(false)
    expect(m.reason).toBe('mushroom = champignon')
  })

  it('honours a decline (no match, not the top hit)', async () => {
    const m = await rerankMatch({ name: 'saffron' }, cands, 'ah', {
      model: MODEL,
      generateObject: stubGen({
        productId: null,
        confidence: 'none',
        reason: 'no saffron in list',
      }),
    })
    expect(m.match.product).toBeNull()
    expect(m.declined).toBe(true)
    expect(m.reason).toBe('no saffron in list')
  })

  it('ignores an unknown id (no match)', async () => {
    const m = await rerankMatch({ name: 'x' }, cands, 'ah', {
      model: MODEL,
      generateObject: stubGen({
        productId: 'not-in-list',
        confidence: 'high',
        reason: 'oops',
      }),
    })
    expect(m.match.product).toBeNull()
  })

  it('resolves when the model returns a display name instead of slug', async () => {
    const meat = [
      candidate('AH Mager rundergehakt', 429, 'ah-gehakt', 0.71),
      candidate('Redefine Meat Beef mince', 399, 'redefine-beef-mince', 0.68),
    ]
    const m = await rerankMatch({ name: 'minced beef' }, meat, 'ah', {
      model: MODEL,
      generateObject: stubGen({
        productId: 'AH Mager rundergehakt',
        confidence: 'high',
        reason: 'real beef over plant-based',
      }),
    })
    expect(m.match.product?.slug).toBe('ah-gehakt')
    expect(m.reason).toBe('real beef over plant-based')
  })

  it('returns no-match on a model error instead of trusting raw cosine', async () => {
    const failing: GenerateObjectFn = async () => {
      throw new Error('rate limited')
    }
    const m = await rerankMatch({ name: 'mushroom' }, cands, 'ah', {
      model: MODEL,
      generateObject: failing,
    })
    expect(m.match.product).toBeNull()
    expect(m.llmFallback).toBe(true)
  })
})
