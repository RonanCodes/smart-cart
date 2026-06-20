import { describe, it, expect } from 'vitest'
import { isRateableDay } from './rate-meal-server'

describe('isRateableDay', () => {
  it('is rateable when the day has a recipe and is not eating-out', () => {
    expect(isRateableDay({ recipeRef: 'r1', type: 'home' })).toBe(true)
    expect(isRateableDay({ recipeRef: 'r1', type: 'busy' })).toBe(true)
    // Absent type reads as a home-cooked day for older plans.
    expect(isRateableDay({ recipeRef: 'r1' })).toBe(true)
  })

  it('is not rateable for an eating-out day', () => {
    expect(isRateableDay({ recipeRef: 'r1', type: 'out' })).toBe(false)
  })

  it('is not rateable when there is no recipe to rate', () => {
    expect(isRateableDay({ type: 'home' })).toBe(false)
    expect(isRateableDay({ recipeRef: '', type: 'home' })).toBe(false)
  })

  it('is not rateable for a missing day', () => {
    expect(isRateableDay(null)).toBe(false)
    expect(isRateableDay(undefined)).toBe(false)
  })
})
