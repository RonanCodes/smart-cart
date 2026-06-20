import { describe, it, expect } from 'vitest'
import { deriveBadges } from './badges'

/**
 * Badges now come from the FORM profile (#208): liked cuisines (lowercased by
 * the mapping), a diet badge, and goal badges. The legacy swipe `lovedTastes`
 * path stays supported so pre-form households keep their badges.
 */
describe('deriveBadges (form data)', () => {
  it('maps lowercased form cuisines to the right cuisine badges', () => {
    const badges = deriveBadges({ cuisinesLiked: ['italian', 'thai'] })
    const labels = badges.map((b) => b.label)
    expect(labels).toContain('Pasta person') // Italian
    expect(labels).toContain('Thai spice seeker')
  })

  it('adds a diet badge when the form set a tag-diet', () => {
    const badges = deriveBadges({ diet: 'vegan' })
    expect(badges.map((b) => b.label)).toContain('Plant-powered')
    expect(deriveBadges({ diet: 'vegetarian' }).map((b) => b.label)).toContain(
      'Veggie-first',
    )
  })

  it('adds goal badges for the exact form goal labels', () => {
    const badges = deriveBadges({
      goals: ['Pay less for my groceries', 'Eat less meat'],
    })
    const labels = badges.map((b) => b.label)
    expect(labels).toContain('Budget cook')
    expect(labels).toContain('Meat-light')
  })

  it('produces a sensible mix for a typical form user', () => {
    const badges = deriveBadges({
      cuisinesLiked: ['japanese'],
      diet: 'vegetarian',
      goals: ['Lighten the mental load'],
    })
    const labels = badges.map((b) => b.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Umami hunter',
        'Veggie-first',
        'Low-effort planner',
      ]),
    )
  })

  it('skips an unknown goal rather than inventing a badge', () => {
    expect(deriveBadges({ goals: ['Climb a mountain'] })).toHaveLength(0)
  })

  it('falls back to an emoji badge for an unmapped liked cuisine', () => {
    const badges = deriveBadges({ cuisinesLiked: ['dutch'] })
    expect(badges).toEqual([{ emoji: '😋', label: 'Dutch lover' }])
  })

  it('dedupes and caps at six badges', () => {
    const badges = deriveBadges({
      cuisinesLiked: ['italian', 'mexican', 'thai', 'indian', 'chinese'],
      diet: 'vegan',
      goals: [
        'Pay less for my groceries',
        'Eat less meat',
        'Lighten the mental load',
      ],
    })
    expect(badges.length).toBe(6)
    const labels = badges.map((b) => b.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('prefers form cuisines over legacy swipe lovedTastes when both present', () => {
    const badges = deriveBadges({
      cuisinesLiked: ['thai'],
      lovedTastes: ['Italian'],
    })
    const labels = badges.map((b) => b.label)
    expect(labels).toContain('Thai spice seeker')
    expect(labels).not.toContain('Pasta person')
  })

  it('still renders legacy swipe lovedTastes for pre-form households', () => {
    const badges = deriveBadges({ lovedTastes: ['Mexican', 'chicken'] })
    const labels = badges.map((b) => b.label)
    expect(labels).toContain('Burrito lover')
    expect(labels).toContain('Chicken loyalist')
  })

  it('empty profile yields no badges', () => {
    expect(deriveBadges({})).toEqual([])
  })
})
