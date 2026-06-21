import { describe, it, expect } from 'vitest'
import {
  mondayOf,
  weekStartForOffset,
  offsetForWeekStart,
  weekLabel,
} from './week-offset'

describe('mondayOf', () => {
  it('returns the same Monday for a Monday', () => {
    // 2026-06-15 is a Monday.
    expect(mondayOf(new Date('2026-06-15T12:00:00Z'))).toBe('2026-06-15')
  })

  it('walks back to Monday from mid-week', () => {
    // 2026-06-18 is a Thursday.
    expect(mondayOf(new Date('2026-06-18T09:00:00Z'))).toBe('2026-06-15')
  })

  it('treats Sunday as the END of its week (previous Monday)', () => {
    // 2026-06-21 is a Sunday -> Monday 2026-06-15.
    expect(mondayOf(new Date('2026-06-21T23:00:00Z'))).toBe('2026-06-15')
  })
})

describe('weekStartForOffset', () => {
  const now = new Date('2026-06-17T10:00:00Z') // Wednesday, week of Mon 15th.

  it('offset 0 = this week Monday', () => {
    expect(weekStartForOffset(0, now)).toBe('2026-06-15')
  })

  it('offset +1 = next Monday', () => {
    expect(weekStartForOffset(1, now)).toBe('2026-06-22')
  })

  it('offset -1 = previous Monday', () => {
    expect(weekStartForOffset(-1, now)).toBe('2026-06-08')
  })

  it('offset +3 = three Mondays ahead', () => {
    expect(weekStartForOffset(3, now)).toBe('2026-07-06')
  })

  it('crosses a month boundary correctly going forward', () => {
    // From week of 2026-06-29 (Mon), +1 lands in July.
    const lateJune = new Date('2026-06-30T10:00:00Z') // Tuesday
    expect(weekStartForOffset(0, lateJune)).toBe('2026-06-29')
    expect(weekStartForOffset(1, lateJune)).toBe('2026-07-06')
  })
})

describe('offsetForWeekStart (inverse of weekStartForOffset)', () => {
  const now = new Date('2026-06-17T10:00:00Z')

  it('round-trips offsets', () => {
    for (const offset of [-3, -1, 0, 1, 5]) {
      const ws = weekStartForOffset(offset, now)
      expect(offsetForWeekStart(ws, now)).toBe(offset)
    }
  })
})

describe('weekLabel', () => {
  const now = new Date('2026-06-17T10:00:00Z')
  it('labels near weeks in words', () => {
    expect(weekLabel(0, now)).toBe('This week')
    expect(weekLabel(1, now)).toBe('Next week')
    expect(weekLabel(-1, now)).toBe('Last week')
  })
  it('labels far weeks by date', () => {
    expect(weekLabel(2, now)).toMatch(/^Week of /)
  })
})
