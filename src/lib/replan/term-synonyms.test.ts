import { describe, expect, it } from 'vitest'
import { expandTerm } from './term-synonyms'

describe('expandTerm — EN/NL food synonym expansion (#177)', () => {
  it('maps English "rice" to the Dutch catalogue words', () => {
    const v = expandTerm('rice')
    expect(v).toContain('rice')
    expect(v).toContain('rijst')
    expect(v).toContain('risotto')
  })

  it('maps "pasta" to common pasta dish words', () => {
    const v = expandTerm('pasta')
    expect(v).toContain('pasta')
    expect(v).toContain('spaghetti')
    expect(v).toContain('penne')
  })

  it('maps "chicken" to "kip"', () => {
    expect(expandTerm('chicken')).toContain('kip')
  })

  it('always includes the literal term for an unmapped word', () => {
    expect(expandTerm('quinoa')).toEqual(['quinoa'])
  })

  it('is case- and whitespace-insensitive and de-duplicates', () => {
    const v = expandTerm('  RICE  ')
    expect(v).toContain('rijst')
    expect(new Set(v).size).toBe(v.length)
  })

  it('returns nothing for an empty term', () => {
    expect(expandTerm('')).toEqual([])
    expect(expandTerm('   ')).toEqual([])
  })
})
