import { describe, expect, it } from 'vitest'
import {
  expandSchema,
  expandIngredientSearchTerms,
  normaliseSearchTerms,
} from './expand-ingredient'
import type { ExpandGenerateObject } from './expand-ingredient'

const MODEL = { id: 'stub' } as never

function stubExpand(terms: Array<string>): ExpandGenerateObject {
  return async () => ({ object: expandSchema.parse({ terms }) })
}

describe('normaliseSearchTerms', () => {
  it('dedupes and keeps the original first', () => {
    expect(
      normaliseSearchTerms('minced chicken', [
        'minced chicken',
        'kipgehakt',
        'Kipgehakt',
      ]),
    ).toEqual(['minced chicken', 'kipgehakt'])
  })
})

describe('expandIngredientSearchTerms', () => {
  it('returns [ingredient] without a model', async () => {
    expect(await expandIngredientSearchTerms('rice', {})).toEqual({
      terms: ['rice'],
      expandFallback: true,
    })
  })

  it('merges LLM terms with the original', async () => {
    const { terms, expandFallback } = await expandIngredientSearchTerms(
      'minced chicken',
      {
        model: MODEL,
        generateObject: stubExpand(['minced chicken', 'kipgehakt']),
      },
    )
    expect(terms).toEqual(['minced chicken', 'kipgehakt'])
    expect(expandFallback).toBe(false)
  })

  it('falls back to original on error', async () => {
    const { terms, expandFallback } = await expandIngredientSearchTerms(
      'rice',
      {
        model: MODEL,
        generateObject: async () => {
          throw new Error('rate limited')
        },
      },
    )
    expect(terms).toEqual(['rice'])
    expect(expandFallback).toBe(true)
  })
})
