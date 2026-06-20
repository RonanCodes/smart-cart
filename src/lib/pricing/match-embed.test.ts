import { describe, expect, it } from 'vitest'
import {
  buildRerankPrompt,
  confidenceFromVectorScore,
  matchIngredientEmbedded,
  rerankMatch,
  rerankSchema,
} from './match-embed'
import type {
  GenerateObjectFn,
  ProductCandidate,
  RetrieveFn,
} from './match-embed'
import type { StoreProduct } from './types'

/** Minimal StoreProduct fixture. */
function product(
  name: string,
  priceCents: number,
  opts: { slug?: string; size?: string } = {},
): StoreProduct {
  return {
    store: 'ah',
    name,
    normalisedName: name.toLowerCase(),
    priceCents,
    slug: opts.slug ?? name.toLowerCase().replace(/\s+/g, '-'),
    size: {
      raw: opts.size ?? '',
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
  score: number,
  opts?: { slug?: string; size?: string },
): ProductCandidate {
  return { product: product(name, priceCents, opts), score }
}

/** A generateObject stub that always returns the given object. */
function stubGen(object: {
  choice: number
  confidence: 'high' | 'medium' | 'low'
  reason: string
}): GenerateObjectFn {
  return async () => ({ object: rerankSchema.parse(object) })
}

const MODEL = { id: 'stub' } as never

describe('confidenceFromVectorScore', () => {
  it('bands the vector score', () => {
    expect(confidenceFromVectorScore(0.9)).toBe('high')
    expect(confidenceFromVectorScore(0.75)).toBe('high')
    expect(confidenceFromVectorScore(0.65)).toBe('medium')
    expect(confidenceFromVectorScore(0.5)).toBe('low')
    expect(confidenceFromVectorScore(0)).toBe('none')
  })
})

describe('buildRerankPrompt', () => {
  it('lists the ingredient with quantity and numbered candidates', () => {
    const { system, prompt } = buildRerankPrompt(
      { name: 'mushroom', qty: '250', unit: 'g' },
      [
        candidate('AH Champignons', 149, 0.8, { size: '250 g' }),
        candidate('AH Tomatenblokjes', 89, 0.5),
      ],
    )
    expect(system).toContain('match')
    expect(prompt).toContain('Ingredient: mushroom (250 g)')
    expect(prompt).toContain('0: AH Champignons (EUR 1.49, 250 g)')
    expect(prompt).toContain('1: AH Tomatenblokjes (EUR 0.89)')
  })

  it('omits the quantity bracket when none is given', () => {
    const { prompt } = buildRerankPrompt({ name: 'knoflook' }, [
      candidate('AH Knoflook', 59, 0.9),
    ])
    expect(prompt).toContain('Ingredient: knoflook\n')
  })
})

describe('rerankMatch (no model)', () => {
  it('returns the top candidate with confidence from its vector score', async () => {
    const match = await rerankMatch(
      { name: 'mushroom' },
      [candidate('AH Champignons', 149, 0.82), candidate('AH Tomaat', 99, 0.5)],
      'ah',
    )
    expect(match.product?.name).toBe('AH Champignons')
    expect(match.confidence).toBe('high')
    expect(match.estimated).toBe(false)
    expect(match.priceCents).toBe(149)
  })

  it('returns no match when nothing was retrieved', async () => {
    const match = await rerankMatch({ name: 'unobtanium' }, [], 'ah')
    expect(match.product).toBeNull()
    expect(match.confidence).toBe('none')
    expect(match.estimated).toBe(true)
  })

  it('returns no match when the top hit is below the confidence floor', async () => {
    const match = await rerankMatch(
      { name: 'mushroom' },
      [candidate('AH Iets', 99, 0)],
      'ah',
    )
    expect(match.product).toBeNull()
    expect(match.confidence).toBe('none')
  })
})

describe('rerankMatch (with model)', () => {
  it('picks the model-chosen candidate and uses the model confidence', async () => {
    const candidates = [
      candidate('AH Tomatenblokjes', 89, 0.7),
      candidate('AH Champignons', 149, 0.66),
    ]
    const match = await rerankMatch({ name: 'mushroom' }, candidates, 'ah', {
      model: MODEL,
      generateObject: stubGen({
        choice: 1,
        confidence: 'high',
        reason: 'champignons are mushrooms',
      }),
    })
    expect(match.product?.name).toBe('AH Champignons')
    expect(match.confidence).toBe('high')
    expect(match.estimated).toBe(false)
  })

  it('honours a declined (-1) choice instead of substituting the top hit', async () => {
    const match = await rerankMatch(
      { name: 'saffron' },
      [candidate('AH Paprikapoeder', 99, 0.62)],
      'ah',
      {
        model: MODEL,
        generateObject: stubGen({
          choice: -1,
          confidence: 'low',
          reason: 'no saffron in the list',
        }),
      },
    )
    expect(match.product).toBeNull()
    expect(match.confidence).toBe('none')
  })

  it('degrades to the top vector hit when the model throws', async () => {
    const failing: GenerateObjectFn = async () => {
      throw new Error('rate limited')
    }
    const match = await rerankMatch(
      { name: 'mushroom' },
      [candidate('AH Champignons', 149, 0.8)],
      'ah',
      { model: MODEL, generateObject: failing },
    )
    expect(match.product?.name).toBe('AH Champignons')
    expect(match.confidence).toBe('high')
  })
})

describe('matchIngredientEmbedded', () => {
  it('filters below the retrieve floor, sorts, and reranks (cross-lingual)', async () => {
    const retrieve: RetrieveFn = async () => [
      candidate('AH Tomatenblokjes', 89, 0.48),
      candidate('AH Champignons', 149, 0.71, { slug: 'champignons' }),
      candidate('AH Iets vaags', 99, 0.2), // below RETRIEVE_FLOOR, dropped
    ]
    let seenCandidateCount = -1
    const gen: GenerateObjectFn = async ({ prompt }) => {
      // Two candidates survive the floor; the dropped one must not appear.
      seenCandidateCount = (prompt.match(/^\d+: /gm) ?? []).length
      const idx = prompt.split('\n').findIndex((l) => l.includes('Champignons'))
      // Map the displayed line back to its candidate index.
      const line = prompt.split('\n').find((l) => l.includes('Champignons'))!
      const choice = Number(line.split(':')[0])
      void idx
      return {
        object: rerankSchema.parse({
          choice,
          confidence: 'high',
          reason: 'mushroom == champignon',
        }),
      }
    }

    const match = await matchIngredientEmbedded({ name: 'mushroom' }, 'ah', {
      retrieve,
      model: MODEL,
      generateObject: gen,
    })

    expect(seenCandidateCount).toBe(2)
    expect(match.product?.name).toBe('AH Champignons')
    expect(match.confidence).toBe('high')
  })

  it('returns no match for an empty ingredient name', async () => {
    const retrieve: RetrieveFn = async () => {
      throw new Error('should not be called')
    }
    const match = await matchIngredientEmbedded({ name: '   ' }, 'ah', {
      retrieve,
    })
    expect(match.product).toBeNull()
    expect(match.confidence).toBe('none')
  })
})
