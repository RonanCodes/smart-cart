import { describe, it, expect } from 'vitest'
import { subscriptionToRow, buildRateMealPayload, weekUrl } from './push'

describe('subscriptionToRow', () => {
  const good = {
    endpoint: 'https://push.example/abc',
    keys: { p256dh: 'PUB', auth: 'SECRET' },
  }

  it('maps a well-formed subscription to a row', () => {
    expect(subscriptionToRow('hh1', good)).toEqual({
      householdId: 'hh1',
      endpoint: 'https://push.example/abc',
      p256dh: 'PUB',
      auth: 'SECRET',
    })
  })

  it('trims whitespace on the stored values', () => {
    expect(
      subscriptionToRow('hh1', {
        endpoint: '  https://push.example/abc  ',
        keys: { p256dh: ' PUB ', auth: ' SECRET ' },
      }),
    ).toEqual({
      householdId: 'hh1',
      endpoint: 'https://push.example/abc',
      p256dh: 'PUB',
      auth: 'SECRET',
    })
  })

  it('returns null when the household is missing', () => {
    expect(subscriptionToRow('', good)).toBeNull()
  })

  it('returns null when the endpoint is missing', () => {
    expect(
      subscriptionToRow('hh1', { keys: { p256dh: 'PUB', auth: 'SECRET' } }),
    ).toBeNull()
  })

  it('returns null when a key is missing', () => {
    expect(
      subscriptionToRow('hh1', {
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'PUB' },
      }),
    ).toBeNull()
    expect(subscriptionToRow('hh1', null)).toBeNull()
    expect(subscriptionToRow('hh1', undefined)).toBeNull()
  })
})

describe('weekUrl', () => {
  it('deep-links to a specific plan when given one', () => {
    expect(weekUrl('p 1')).toBe('/week?plan=p%201')
  })
  it('falls back to the bare week route with no plan', () => {
    expect(weekUrl()).toBe('/week')
    expect(weekUrl(null)).toBe('/week')
  })
})

describe('buildRateMealPayload', () => {
  it('weaves the meal name into the body and deep-links to the plan', () => {
    expect(
      buildRateMealPayload({ mealName: 'Thai green curry', planId: 'p1' }),
    ).toEqual({
      title: 'Souso',
      body: 'How was Thai green curry? Tap to rate.',
      url: '/week?plan=p1',
    })
  })

  it('degrades to a generic prompt when the meal name is blank', () => {
    expect(buildRateMealPayload({ mealName: '   ' })).toEqual({
      title: 'Souso',
      body: 'How was your dinner? Tap to rate.',
      url: '/week',
    })
  })
})
