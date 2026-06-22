import { describe, it, expect } from 'vitest'
import {
  summarizeUsers,
  signupsByDay,
  filterUsers,
  sortUsers,
} from './users-view'
import type { AdminUserRow } from '#/lib/admin-server'

// 2026-06-21T12:00:00.000Z, a fixed "now" so the time-based helpers are
// deterministic (the helpers never call Date.now() themselves).
const NOW = Date.parse('2026-06-21T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function row(over: Partial<AdminUserRow>): AdminUserRow {
  return {
    userId: 'u1',
    email: 'a@b.com',
    householdId: 'h1',
    swipes: 0,
    badges: [],
    isAdmin: false,
    access: 'user',
    onboarded: false,
    configAdmin: false,
    revocable: false,
    createdAt: null,
    phone: null,
    ...over,
  }
}

describe('summarizeUsers', () => {
  it('counts totals, onboarded, admins, swipes, and new-this-week', () => {
    const rows = [
      row({ email: 'admin@b.com', isAdmin: true, swipes: 5, createdAt: NOW }),
      row({
        email: 'onb@b.com',
        onboarded: true,
        swipes: 10,
        createdAt: NOW - 2 * DAY,
      }),
      // 10 days ago: NOT new this week.
      row({ email: 'old@b.com', swipes: 3, createdAt: NOW - 10 * DAY }),
      // null createdAt: counts as an account, never new-this-week.
      row({ email: 'env@b.com', userId: null, swipes: 0, createdAt: null }),
    ]
    const s = summarizeUsers(rows, NOW)
    expect(s.total).toBe(4)
    expect(s.onboarded).toBe(1)
    expect(s.admins).toBe(1)
    expect(s.swipes).toBe(18)
    expect(s.newThisWeek).toBe(2) // admin@ (today) + onb@ (2 days ago)
  })

  it('handles an empty list', () => {
    const s = summarizeUsers([], NOW)
    expect(s).toEqual({
      total: 0,
      onboarded: 0,
      admins: 0,
      swipes: 0,
      newThisWeek: 0,
    })
  })

  it('counts a signup exactly 7 days ago as NOT new-this-week (strict window)', () => {
    const s = summarizeUsers([row({ createdAt: NOW - 7 * DAY })], NOW)
    expect(s.newThisWeek).toBe(0)
  })
})

describe('signupsByDay', () => {
  it('buckets signups per day over the window, oldest first, zero-filled', () => {
    const rows = [
      row({ createdAt: NOW }), // today
      row({ createdAt: NOW }), // today
      row({ createdAt: NOW - 2 * DAY }), // 2 days ago
      row({ createdAt: null }), // ignored
      row({ createdAt: NOW - 100 * DAY }), // outside the window, ignored
    ]
    const days = signupsByDay(rows, NOW, 7)
    expect(days).toHaveLength(7)
    // Oldest first; last bucket is "today".
    expect(days.at(-1)?.count).toBe(2)
    expect(days.at(-3)?.count).toBe(1) // 2 days ago
    // Every bucket has an ISO date (yyyy-mm-dd) + a count.
    expect(days[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const total = days.reduce((n, d) => n + d.count, 0)
    expect(total).toBe(3)
  })

  it('returns all-zero buckets when no row has a createdAt', () => {
    const days = signupsByDay([row({ createdAt: null })], NOW, 30)
    expect(days).toHaveLength(30)
    expect(days.every((d) => d.count === 0)).toBe(true)
  })
})

describe('filterUsers', () => {
  const rows = [
    row({ email: 'Alice@Example.com', isAdmin: true, access: 'admin' }),
    row({ email: 'bob@other.com', onboarded: true }),
    row({ email: 'carol@example.com', onboarded: false }),
  ]

  it('filters by case-insensitive email substring', () => {
    expect(filterUsers(rows, { query: 'EXAMPLE' }).map((r) => r.email)).toEqual(
      ['Alice@Example.com', 'carol@example.com'],
    )
  })

  it('empty query returns everything', () => {
    expect(filterUsers(rows, { query: '' })).toHaveLength(3)
    expect(filterUsers(rows, { query: '  ' })).toHaveLength(3)
  })

  it('filters by access: onboarded', () => {
    expect(
      filterUsers(rows, { access: 'onboarded' }).map((r) => r.email),
    ).toEqual(['bob@other.com'])
  })

  it('filters by access: not onboarded', () => {
    expect(
      filterUsers(rows, { access: 'not-onboarded' }).map((r) => r.email),
    ).toEqual(['Alice@Example.com', 'carol@example.com'])
  })

  it('filters by access: admins', () => {
    expect(filterUsers(rows, { access: 'admins' }).map((r) => r.email)).toEqual(
      ['Alice@Example.com'],
    )
  })

  it('combines query and access', () => {
    expect(
      filterUsers(rows, { query: 'example', access: 'admins' }).map(
        (r) => r.email,
      ),
    ).toEqual(['Alice@Example.com'])
  })

  it('does not mutate the input array', () => {
    const copy = [...rows]
    filterUsers(rows, { query: 'a' })
    expect(rows).toEqual(copy)
  })
})

describe('sortUsers', () => {
  const a = row({ email: 'zed@b.com', swipes: 1, createdAt: NOW - 5 * DAY })
  const b = row({ email: 'amy@b.com', swipes: 9, createdAt: NOW })
  const c = row({ email: 'mid@b.com', swipes: 4, createdAt: null })
  const rows = [a, b, c]

  it('sorts by email A-Z', () => {
    expect(sortUsers(rows, 'email').map((r) => r.email)).toEqual([
      'amy@b.com',
      'mid@b.com',
      'zed@b.com',
    ])
  })

  it('sorts by swipes high-to-low', () => {
    expect(sortUsers(rows, 'swipes').map((r) => r.swipes)).toEqual([9, 4, 1])
  })

  it('sorts by signup newest-first, nulls last (stable original order)', () => {
    expect(sortUsers(rows, 'newest').map((r) => r.email)).toEqual([
      'amy@b.com', // NOW
      'zed@b.com', // 5 days ago
      'mid@b.com', // null -> last
    ])
  })

  it('does not mutate the input array', () => {
    const copy = [...rows]
    sortUsers(rows, 'swipes')
    expect(rows).toEqual(copy)
  })
})
