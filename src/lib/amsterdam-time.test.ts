import { describe, it, expect } from 'vitest'
import {
  amsterdamParts,
  floorTo15,
  isInBucket,
  isRateMealBucket,
  isPlanReminderBucket,
} from './amsterdam-time'

describe('amsterdamParts', () => {
  it('projects a UTC instant into Amsterdam summer time (CEST = UTC+2)', () => {
    // 2026-06-17 is a Wednesday. 18:00 UTC = 20:00 Amsterdam (CEST).
    const p = amsterdamParts(new Date('2026-06-17T18:00:00Z'))
    expect(p).toEqual({ date: '2026-06-17', hour: 20, minute: 0, dow: 3 })
  })

  it('projects a UTC instant into Amsterdam winter time (CET = UTC+1)', () => {
    // 2026-01-14 is a Wednesday. 19:00 UTC = 20:00 Amsterdam (CET).
    const p = amsterdamParts(new Date('2026-01-14T19:00:00Z'))
    expect(p).toEqual({ date: '2026-01-14', hour: 20, minute: 0, dow: 3 })
  })

  it('reports the local calendar date across the UTC midnight boundary', () => {
    // 23:30 UTC in June = 01:30 next-day Amsterdam.
    const p = amsterdamParts(new Date('2026-06-17T23:30:00Z'))
    expect(p.date).toBe('2026-06-18')
    expect(p.hour).toBe(1)
  })

  it('maps Sunday to dow 0', () => {
    // 2026-06-21 Sunday, 10:00 UTC = 12:00 Amsterdam.
    expect(amsterdamParts(new Date('2026-06-21T10:00:00Z')).dow).toBe(0)
  })
})

describe('floorTo15', () => {
  it('floors to the 15-min grid', () => {
    expect(floorTo15(0)).toBe(0)
    expect(floorTo15(7)).toBe(0)
    expect(floorTo15(14)).toBe(0)
    expect(floorTo15(15)).toBe(15)
    expect(floorTo15(29)).toBe(15)
    expect(floorTo15(45)).toBe(45)
    expect(floorTo15(59)).toBe(45)
  })
})

describe('isRateMealBucket (20:00 Amsterdam)', () => {
  it('matches the 20:00 tick in summer', () => {
    expect(isRateMealBucket(new Date('2026-06-17T18:00:00Z'))).toBe(true)
  })
  it('matches anywhere in the 20:00..20:14 bucket', () => {
    expect(isRateMealBucket(new Date('2026-06-17T18:14:00Z'))).toBe(true)
  })
  it('does NOT match the 20:15 tick', () => {
    expect(isRateMealBucket(new Date('2026-06-17T18:15:00Z'))).toBe(false)
  })
  it('does NOT match 19:45', () => {
    expect(isRateMealBucket(new Date('2026-06-17T17:45:00Z'))).toBe(false)
  })
  it('matches the 20:00 tick in winter (DST shift)', () => {
    expect(isRateMealBucket(new Date('2026-01-14T19:00:00Z'))).toBe(true)
    // Same UTC time in summer would be 21:00 Amsterdam -> no match.
    expect(isRateMealBucket(new Date('2026-06-17T19:00:00Z'))).toBe(false)
  })
})

describe('isInBucket', () => {
  it('matches an arbitrary HH:MM bucket', () => {
    // 15:30 UTC summer = 17:30 Amsterdam.
    expect(isInBucket(new Date('2026-06-17T15:30:00Z'), 17, 30)).toBe(true)
    expect(isInBucket(new Date('2026-06-17T15:38:00Z'), 17, 30)).toBe(true)
    expect(isInBucket(new Date('2026-06-17T15:45:00Z'), 17, 30)).toBe(false)
  })
})

describe('isPlanReminderBucket', () => {
  it('matches on the right Amsterdam day + time', () => {
    // 2026-06-21 Sunday (dow 0), 15:00 UTC = 17:00 Amsterdam.
    expect(
      isPlanReminderBucket(new Date('2026-06-21T15:00:00Z'), 0, '17:00'),
    ).toBe(true)
  })
  it('does NOT match the wrong day', () => {
    // Same time but a Wednesday.
    expect(
      isPlanReminderBucket(new Date('2026-06-17T15:00:00Z'), 0, '17:00'),
    ).toBe(false)
  })
  it('does NOT match the wrong time', () => {
    expect(
      isPlanReminderBucket(new Date('2026-06-21T16:00:00Z'), 0, '17:00'),
    ).toBe(false)
  })
  it('matches within the 15-min bucket of the target time', () => {
    // 17:08 Amsterdam still in the 17:00 bucket.
    expect(
      isPlanReminderBucket(new Date('2026-06-21T15:08:00Z'), 0, '17:00'),
    ).toBe(true)
  })
  it('rejects a malformed time', () => {
    expect(
      isPlanReminderBucket(new Date('2026-06-21T15:00:00Z'), 0, 'bad'),
    ).toBe(false)
  })
})
