import { describe, expect, it } from 'vitest'
import {
  buildRerankPrompt,
  candidateId,
  rerankSchema,
  resolveCandidate,
  runRerank,
} from './rerank-sku'
import type { GenerateObjectFn, ProductCandidate } from './rerank-sku'
import type { StoreProduct } from './types'

function product(
  name: string,
  slug: string,
  size = '500 g',
  priceCents = 429,
): StoreProduct {
  return {
    store: 'ah',
    name,
    normalisedName: name.toLowerCase(),
    priceCents,
    slug,
    size: {
      raw: size,
      quantity: 500,
      unit: 'g',
      dimension: 'mass',
      approx: false,
    },
  }
}

function cand(
  name: string,
  slug: string,
  score: number,
  size?: string,
): ProductCandidate {
  return { product: product(name, slug, size), score }
}

const MODEL = { id: 'stub' } as never

function stubGen(object: {
  productId: string | null
  confidence: 'high' | 'medium' | 'low' | 'none'
  reason: string
}): GenerateObjectFn {
  return async () => ({ object: rerankSchema.parse(object) })
}

describe('buildRerankPrompt', () => {
  it('numbers candidates and lists valid productIds', () => {
    const { prompt } = buildRerankPrompt(
      { name: 'minced beef', qty: '500', unit: 'g' },
      [
        cand('AH Mager rundergehakt', 'ah-gehakt', 0.71),
        cand('Redefine Meat Beef mince', 'redefine-beef-mince', 0.68),
      ],
    )
    expect(prompt).toContain('Ingredient to buy: minced beef (500 g)')
    expect(prompt).toContain('1. productId: ah-gehakt')
    expect(prompt).toContain('2. productId: redefine-beef-mince')
    expect(prompt).toContain('pack: 500 g')
    expect(prompt).toContain(
      'Valid productId values: ah-gehakt, redefine-beef-mince',
    )
  })

  it('includes recipe and dietary context when provided', () => {
    const { prompt } = buildRerankPrompt(
      {
        name: 'minced beef',
        recipeTitle: 'Spaghetti Bolognese',
        dietaryTags: ['vegetarian'],
      },
      [cand('AH Mager rundergehakt', 'ah-gehakt', 0.71)],
    )
    expect(prompt).toContain('Recipe: Spaghetti Bolognese')
    expect(prompt).toContain('Dietary constraints: vegetarian')
  })
})

describe('resolveCandidate', () => {
  const cands = [
    cand('AH Mager rundergehakt', 'ah-gehakt', 0.71),
    cand('Redefine Meat Beef mince', 'redefine-beef-mince', 0.68),
  ]

  it('matches exact productId slug', () => {
    expect(resolveCandidate('ah-gehakt', cands)?.product.slug).toBe('ah-gehakt')
  })

  it('matches case-insensitive slug', () => {
    expect(resolveCandidate('AH-GEHAKT', cands)?.product.slug).toBe('ah-gehakt')
  })

  it('falls back when the model returns the display name', () => {
    expect(resolveCandidate('AH Mager rundergehakt', cands)?.product.slug).toBe(
      'ah-gehakt',
    )
  })

  it('returns undefined for unknown ids', () => {
    expect(resolveCandidate('not-in-list', cands)).toBeUndefined()
  })
})

describe('runRerank', () => {
  const cands = [
    cand('AH Mager rundergehakt', 'ah-gehakt', 0.71),
    cand('Redefine Meat Beef mince', 'redefine-beef-mince', 0.68),
  ]

  it('accepts productId slug from the model', async () => {
    const r = await runRerank({ name: 'minced beef' }, cands, {
      model: MODEL,
      generateObject: stubGen({
        productId: 'ah-gehakt',
        confidence: 'high',
        reason: 'real beef mince',
      }),
    })
    expect(r?.kind).toBe('pick')
    if (r?.kind === 'pick') {
      expect(r.candidate.product.slug).toBe('ah-gehakt')
    }
  })

  it('accepts display name when the model ignores the slug rule', async () => {
    const r = await runRerank({ name: 'minced beef' }, cands, {
      model: MODEL,
      generateObject: stubGen({
        productId: 'AH Mager rundergehakt',
        confidence: 'high',
        reason: 'traditional minced beef over plant-based',
      }),
    })
    expect(r?.kind).toBe('pick')
    if (r?.kind === 'pick') {
      expect(r.candidate.product.slug).toBe('ah-gehakt')
    }
  })

  it('declines on null productId with reason', async () => {
    const r = await runRerank({ name: 'saffron' }, cands, {
      model: MODEL,
      generateObject: stubGen({
        productId: null,
        confidence: 'none',
        reason: 'no saffron',
      }),
    })
    expect(r).toEqual({ kind: 'decline', reason: 'no saffron' })
  })
})

describe('candidateId', () => {
  it('prefers slug over normalisedName', () => {
    expect(candidateId(product('AH Melk', 'ah-melk'))).toBe('ah-melk')
  })
})
