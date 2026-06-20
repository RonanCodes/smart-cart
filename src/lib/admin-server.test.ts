import { describe, it, expect } from 'vitest'
import { shapeWaitlist } from './admin-server'

describe('shapeWaitlist', () => {
  it('returns count + newest-first rows, dates as ISO strings', () => {
    const older = new Date('2026-01-01T10:00:00.000Z')
    const newer = new Date('2026-06-01T10:00:00.000Z')
    const view = shapeWaitlist([
      { email: 'old@b.com', createdAt: older },
      { email: 'new@b.com', createdAt: newer },
    ])

    expect(view.count).toBe(2)
    expect(view.rows.map((r) => r.email)).toEqual(['new@b.com', 'old@b.com'])
    expect(view.rows[0]!.createdAt).toBe(newer.toISOString())
  })

  it('coerces numeric and string timestamps to ISO', () => {
    const ms = Date.UTC(2026, 5, 15, 12, 0, 0)
    const view = shapeWaitlist([
      { email: 'a@b.com', createdAt: ms },
      { email: 'c@d.com', createdAt: '2026-02-01T00:00:00.000Z' },
    ])
    expect(view.rows[0]!.email).toBe('a@b.com') // June > Feb, newest first
    expect(view.rows[0]!.createdAt).toBe(new Date(ms).toISOString())
  })

  it('handles an empty waitlist', () => {
    expect(shapeWaitlist([])).toEqual({ count: 0, rows: [] })
  })
})
