import { describe, it, expect } from 'vitest'
import {
  SYNONYM_GROUPS,
  canonicalDislikeKey,
  dedupeSynonyms,
} from './dislike-synonyms'

describe('dislike synonyms (#370)', () => {
  it('treats cilantro and coriander as the same herb', () => {
    expect(canonicalDislikeKey('Cilantro')).toBe(
      canonicalDislikeKey('Coriander'),
    )
  })

  it('canonicalises case-insensitively', () => {
    expect(canonicalDislikeKey('CILANTRO')).toBe(
      canonicalDislikeKey('coriander'),
    )
  })

  it('leaves a label with no synonym unchanged (lowercased key)', () => {
    expect(canonicalDislikeKey('Mushroom')).toBe('mushroom')
  })

  it('dedupes a list so Cilantro and Coriander never both appear', () => {
    const out = dedupeSynonyms(['Cilantro', 'Coriander'])
    expect(out).toHaveLength(1)
  })

  it('keeps the FIRST-seen label verbatim when collapsing a synonym pair', () => {
    // First occurrence wins; the later synonym is dropped.
    expect(dedupeSynonyms(['Cilantro', 'Coriander'])).toEqual(['Cilantro'])
    expect(dedupeSynonyms(['Coriander', 'Cilantro'])).toEqual(['Coriander'])
  })

  it('preserves order and non-synonym labels', () => {
    const out = dedupeSynonyms(['Egg', 'Cilantro', 'Mushroom', 'Coriander'])
    expect(out).toEqual(['Egg', 'Cilantro', 'Mushroom'])
  })

  it('also dedupes plain case-duplicate labels', () => {
    expect(dedupeSynonyms(['Egg', 'egg'])).toEqual(['Egg'])
  })

  it('every synonym group has a distinct canonical key', () => {
    const canon = SYNONYM_GROUPS.map((g) => g[0]!.toLowerCase())
    expect(new Set(canon).size).toBe(canon.length)
  })
})

describe('the onboarding preset chip list has no synonym duplicate (#370)', () => {
  // The bug: the Dislikes step's SUGGESTED list shipped both 'Cilantro' AND
  // 'Coriander'. Guard the deduped preset directly.
  const RAW_SUGGESTED = [
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

  it('collapses the cilantro/coriander pair to one chip', () => {
    const deduped = dedupeSynonyms(RAW_SUGGESTED)
    const canonKeys = deduped.map(canonicalDislikeKey)
    expect(new Set(canonKeys).size).toBe(canonKeys.length)
    // Exactly one of the cilantro/coriander pair survives.
    const coriander = canonicalDislikeKey('coriander')
    expect(canonKeys.filter((k) => k === coriander)).toHaveLength(1)
  })
})
