import { describe, it, expect } from 'vitest'
import {
  subscriptionToRow,
  buildRateMealPayload,
  weekUrl,
  rateMealUrl,
} from './push'

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

describe('rateMealUrl', () => {
  it('deep-links to the focused rate view for a plan + day', () => {
    expect(rateMealUrl('p 1', 'Monday')).toBe('/rate/p%201/Monday')
  })
  it('falls back to the week when the day is missing', () => {
    expect(rateMealUrl('p1')).toBe('/week?plan=p1')
    expect(rateMealUrl('p1', null)).toBe('/week?plan=p1')
  })
  it('falls back to the bare week when there is no plan', () => {
    expect(rateMealUrl()).toBe('/week')
    expect(rateMealUrl(null, 'Monday')).toBe('/week')
  })
})

describe('buildRateMealPayload', () => {
  it('uses a hook title, weaves the meal into the body, and deep-links to the focused view', () => {
    expect(
      buildRateMealPayload({
        mealName: 'Thai green curry',
        planId: 'p1',
        day: 'Monday',
      }),
    ).toEqual({
      title: 'How was dinner?',
      body: 'How was Thai green curry? Tap to rate.',
      url: '/rate/p1/Monday',
    })
  })

  it('never repeats the app name in the title (#214: iOS shows Souso already)', () => {
    expect(
      buildRateMealPayload({ mealName: 'Tacos', planId: 'p1', day: 'Tue' })
        .title,
    ).not.toContain('Souso')
  })

  it('degrades to a generic prompt + the week when the meal name is blank', () => {
    expect(buildRateMealPayload({ mealName: '   ' })).toEqual({
      title: 'How was dinner?',
      body: 'How was your dinner? Tap to rate.',
      url: '/week',
    })
  })
})
