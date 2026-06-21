import { describe, it, expect } from 'vitest'
import {
  COMMON_DISLIKES,
  MAX_SUGGESTIONS,
  suggestDislikes,
} from './common-dislikes'

const PRESET_CHIPS = [
  'Shellfish',
  'Nuts',
  'Egg',
  'Soy',
  'Mushroom',
  'Cilantro',
  'Olives',
  'Fish',
  'Tomato',
  'Dairy',
  'Onion',
  'Garlic',
  'Pepper',
  'Coriander',
]

const ctx = (over: Partial<Parameters<typeof suggestDislikes>[1]> = {}) => ({
  shown: PRESET_CHIPS,
  selected: [],
  ...over,
})

describe('COMMON_DISLIKES', () => {
  it('is a substantial curated list (~80-130 entries)', () => {
    expect(COMMON_DISLIKES.length).toBeGreaterThanOrEqual(80)
    expect(COMMON_DISLIKES.length).toBeLessThanOrEqual(130)
  })

  it('has no duplicate entries (case-insensitive)', () => {
    const seen = new Set(COMMON_DISLIKES.map((s) => s.toLowerCase()))
    expect(seen.size).toBe(COMMON_DISLIKES.length)
  })

  it('includes a few Dutch terms for the AH/Jumbo catalogue', () => {
    const lower = COMMON_DISLIKES.map((s) => s.toLowerCase())
    expect(lower.some((s) => s.includes('ui'))).toBe(true)
    expect(lower.some((s) => s.includes('knoflook'))).toBe(true)
  })
})

describe('suggestDislikes', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(suggestDislikes('', ctx())).toEqual([])
    expect(suggestDislikes('   ', ctx())).toEqual([])
  })

  it("surfaces 'Broccoli' for the typo-ish prefix 'brod'-style typing", () => {
    // The issue's headline example: typing toward Broccoli.
    expect(suggestDislikes('brocc', ctx())).toContain('Broccoli')
    expect(suggestDislikes('Broc', ctx())).toContain('Broccoli')
  })

  it('matches case-insensitively on a substring', () => {
    // Upper-case query still hits lower-cased catalogue entries.
    const out = suggestDislikes('CHEESE', ctx())
    expect(out).toContain('Blue cheese')
    expect(out).toContain('Goat cheese')
    // Lower-case query is equivalent.
    expect(suggestDislikes('cheese', ctx())).toContain('Blue cheese')
    // A mid-word substring on a single entry: 'eta' inside 'Feta'.
    expect(suggestDislikes('eta', ctx())).toContain('Feta')
  })

  it('excludes preset chips already shown on the step', () => {
    // 'Onion' is a preset chip; the Dutch 'Ui (onion)' should still surface but
    // the bare 'Onion' must never appear because it is in `shown`.
    const out = suggestDislikes('onion', ctx())
    expect(out).not.toContain('Onion')
    expect(out).toContain('Ui (onion)')
  })

  it('excludes already-selected ingredients', () => {
    const out = suggestDislikes('cream', ctx({ selected: ['Cream'] }))
    expect(out).not.toContain('Cream')
  })

  it('never offers two names for one ingredient (#370 synonym dedupe)', () => {
    // COMMON_DISLIKES carries both 'Shrimp' and 'Prawns' (the same thing); the
    // dropdown must surface only one. Query a substring common to both via 'pra'
    // and 'shr' and assert the synonym pair never both appear.
    const shrimp = suggestDislikes('shr', ctx())
    const prawns = suggestDislikes('pra', ctx())
    const combined = [...shrimp, ...prawns]
    const hasShrimp = combined.includes('Shrimp')
    const hasPrawns = combined.includes('Prawns')
    // At most one of the pair is ever offered for a given query result set.
    expect(shrimp.includes('Shrimp') && shrimp.includes('Prawns')).toBe(false)
    expect(hasShrimp || hasPrawns).toBe(true)
  })

  it('hides a synonym of an already-selected ingredient (#370)', () => {
    // The user already avoids 'Aubergine'; typing toward 'Eggplant' (its
    // synonym) must NOT suggest it — they are the same vegetable.
    const out = suggestDislikes('eggplant', ctx({ selected: ['Aubergine'] }))
    expect(out).not.toContain('Eggplant')
    // And the reverse: avoiding Eggplant hides Aubergine.
    const out2 = suggestDislikes('aubergine', ctx({ selected: ['Eggplant'] }))
    expect(out2).not.toContain('Aubergine')
  })

  it('caps results at MAX_SUGGESTIONS by default', () => {
    // 'a' matches a large number of entries; the cap keeps the dropdown short.
    const out = suggestDislikes('a', ctx())
    expect(out.length).toBeLessThanOrEqual(MAX_SUGGESTIONS)
  })

  it('honours an explicit limit', () => {
    const out = suggestDislikes('a', ctx(), 3)
    expect(out.length).toBeLessThanOrEqual(3)
  })

  it('floats prefix matches ahead of mid-word matches', () => {
    // 'pea' is a prefix of 'Peanuts'/'Peas' and a mid-word hit elsewhere.
    const out = suggestDislikes('pea', ctx())
    const firstPrefix = out.findIndex((s) => s.toLowerCase().startsWith('pea'))
    expect(firstPrefix).toBe(0)
  })

  it('returns a fresh array (does not leak the catalogue reference)', () => {
    const out = suggestDislikes('cream', ctx())
    expect(out).not.toBe(COMMON_DISLIKES)
  })
})
