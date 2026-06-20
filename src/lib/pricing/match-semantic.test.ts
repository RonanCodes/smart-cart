import { describe, expect, it } from 'vitest'
import {
  cheapMatch,
  confidenceFromCosine,
  rerankMatch,
  selectCandidates,
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
  it('bands the cosine score', () => {
    expect(confidenceFromCosine(0.7)).toBe('high')
    expect(confidenceFromCosine(0.6)).toBe('high')
    expect(confidenceFromCosine(0.5)).toBe('medium')
    expect(confidenceFromCosine(0.3)).toBe('low')
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

describe('cheapMatch (no LLM)', () => {
  it('takes the top candidate, confidence from cosine', () => {
    const m = cheapMatch('ah', [
      candidate('AH Champignons', 149, 'champignons', 0.72),
      candidate('AH Tomaat', 99, 'tomaat', 0.4),
    ])
    expect(m.product?.name).toBe('AH Champignons')
    expect(m.confidence).toBe('high')
    expect(m.estimated).toBe(false)
    expect(m.priceCents).toBe(149)
  })

  it('no match on empty candidates', () => {
    const m = cheapMatch('ah', [])
    expect(m.product).toBeNull()
    expect(m.confidence).toBe('none')
  })
})

describe('rerankMatch (accurate tier)', () => {
  const cands = [
    candidate('AH Tomatenblokjes', 89, 'tomatenblokjes', 0.55),
    candidate('AH Champignons', 149, 'champignons', 0.5),
  ]

  it('falls back to cheap top-1 with no model', async () => {
    const m = await rerankMatch({ name: 'mushroom' }, cands, 'ah', {})
    expect(m.product?.slug).toBe('tomatenblokjes') // top cosine, no LLM
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
    expect(m.product?.slug).toBe('champignons')
    expect(m.confidence).toBe('high')
    expect(m.estimated).toBe(false)
  })

  it('honours a decline (no match, not the top hit)', async () => {
    const m = await rerankMatch({ name: 'saffron' }, cands, 'ah', {
      model: MODEL,
      generateObject: stubGen({
        productId: null,
        confidence: 'none',
        reason: 'no saffron',
      }),
    })
    expect(m.product).toBeNull()
    expect(m.confidence).toBe('none')
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
    expect(m.product).toBeNull()
  })

  it('falls back to cheap top-1 on a model error', async () => {
    const failing: GenerateObjectFn = async () => {
      throw new Error('rate limited')
    }
    const m = await rerankMatch({ name: 'mushroom' }, cands, 'ah', {
      model: MODEL,
      generateObject: failing,
    })
    expect(m.product?.slug).toBe('tomatenblokjes')
  })
})
