import { describe, it, expect } from 'vitest'
import { mergeProfilePatch, cleanSkipDays } from './profile-edit-server'

/**
 * Pure data-points editor helpers (#data-points). The createServerFns wrap D1
 * around these; here we prove the validation + merge logic with no DB.
 */

describe('cleanSkipDays', () => {
  it('keeps integers in 0..6, deduped and sorted', () => {
    expect(cleanSkipDays([4, 1, 1, 0])).toEqual([0, 1, 4])
  })

  it('drops out-of-range, non-integer and non-number entries', () => {
    expect(cleanSkipDays([4, 7, -1, 2.5, '3' as never, null as never])).toEqual(
      [4],
    )
  })

  it('returns [] for a non-array', () => {
    expect(cleanSkipDays('nope')).toEqual([])
    expect(cleanSkipDays(undefined)).toEqual([])
  })
})

describe('mergeProfilePatch', () => {
  it('preserves untouched fields and only changes patched ones', () => {
    const existing = { adults: 2, goals: ['Pay less for my groceries'] }
    const next = mergeProfilePatch(existing, { cuisinesLiked: ['Italian'] })
    expect(next.adults).toBe(2)
    expect(next.goals).toEqual(['Pay less for my groceries'])
    expect(next.cuisinesLiked).toEqual(['Italian'])
  })

  it('dedupes cuisine lists case-insensitively and a like wins over a hate', () => {
    const next = mergeProfilePatch(
      {},
      {
        cuisinesLiked: ['Italian', 'italian', 'Thai'],
        cuisinesDisliked: ['Thai', 'Mexican'],
      },
    )
    expect(next.cuisinesLiked).toEqual(['Italian', 'Thai'])
    // Thai is liked, so it is stripped from disliked.
    expect(next.cuisinesDisliked).toEqual(['Mexican'])
  })

  it('derives the diet string + allergies from diet + dislikes (hard gates)', () => {
    const next = mergeProfilePatch(
      {},
      { diet: ['Vegan', 'Dairy free'], dislikes: ['Olives'] },
    )
    // Vegan is the strictest tag-diet the planner veg gate understands.
    expect(next.diet).toBe('vegan')
    expect(next.dietLabels).toEqual(['Vegan', 'Dairy free'])
    // dislikes (lowercased) + dairy-free exclusions feed the allergy gate.
    expect(next.dislikes).toEqual(['olives'])
    expect(next.allergies).toEqual(
      expect.arrayContaining(['olives', 'milk', 'cheese', 'butter']),
    )
  })

  it('leaves diet undefined when no tag-diet is picked', () => {
    const next = mergeProfilePatch({}, { diet: ['Gluten free'] })
    expect(next.diet).toBeUndefined()
    expect(next.allergies).toEqual(
      expect.arrayContaining(['wheat', 'flour', 'pasta']),
    )
  })

  it('recomputes allergies from existing dislikes when only diet changes', () => {
    const next = mergeProfilePatch(
      { dislikes: ['peanut'] },
      { diet: ['Porkless'] },
    )
    expect(next.allergies).toEqual(
      expect.arrayContaining(['peanut', 'pork', 'bacon']),
    )
  })

  it('stores a manual skipDays override (cleaned)', () => {
    const next = mergeProfilePatch({}, { skipDays: [4, 4, 9, 0] })
    expect(next.skipDays).toEqual([0, 4])
  })

  it('null skipDays means "use auto-inferred"', () => {
    const next = mergeProfilePatch({ skipDays: [4] }, { skipDays: null })
    expect(next.skipDays).toBeNull()
  })

  it('an empty skipDays array is an explicit "skip no days" override', () => {
    const next = mergeProfilePatch({ skipDays: [4] }, { skipDays: [] })
    expect(next.skipDays).toEqual([])
  })

  it('trims and dedupes free-text dislikes/goals, dropping empties', () => {
    const next = mergeProfilePatch(
      {},
      {
        dislikes: [' Olives ', 'olives', '', 'Tomato'],
        goals: ['Eat less meat', 'Eat less meat'],
      },
    )
    // dislikes are lowercased for the planner; deduped first-seen.
    expect(next.dislikes).toEqual(['olives', 'tomato'])
    expect(next.goals).toEqual(['Eat less meat'])
  })
})
