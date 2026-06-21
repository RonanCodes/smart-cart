import { describe, expect, it } from 'vitest'
import { detectTargetDays } from './target-days'

describe('detectTargetDays', () => {
  it('finds an English day name', () => {
    expect(detectTargetDays('eating out Wednesday')).toEqual(['Wednesday'])
  })

  it('finds a Dutch day name and returns the canonical English label', () => {
    expect(detectTargetDays('we eten uit op woensdag')).toEqual(['Wednesday'])
  })

  it('returns multiple days in week order, deduped', () => {
    expect(
      detectTargetDays('swap Friday and Monday, also friday again'),
    ).toEqual(['Monday', 'Friday'])
  })

  it('returns nothing when no day is named', () => {
    expect(detectTargetDays('no fish please')).toEqual([])
  })

  it('does not match a day name embedded in another word', () => {
    expect(detectTargetDays('sunshine salad')).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(detectTargetDays('TUESDAY please')).toEqual(['Tuesday'])
  })
})
