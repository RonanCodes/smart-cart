import { describe, expect, it } from 'vitest'
import { notifyEnabled, recipientsForWaitlist } from './admin-prefs'

describe('notifyEnabled (default-on)', () => {
  it('defaults to enabled when no row exists', () => {
    expect(notifyEnabled(undefined)).toBe(true)
  })
  it('honours an explicit opt-out', () => {
    expect(notifyEnabled({ waitlistNotify: false })).toBe(false)
  })
  it('honours an explicit re-opt-in', () => {
    expect(notifyEnabled({ waitlistNotify: true })).toBe(true)
  })
})

describe('recipientsForWaitlist', () => {
  const admins = [
    'tech@discopenguin.com',
    'ronan@bluebramble.net',
    'keesmaat123@gmail.com',
  ]

  it('notifies every admin when no prefs are stored (default-on)', () => {
    expect(recipientsForWaitlist(admins, [])).toEqual(admins)
  })

  it('excludes an admin who has opted out', () => {
    const out = recipientsForWaitlist(admins, [
      { email: 'ronan@bluebramble.net', waitlistNotify: false },
    ])
    expect(out).toEqual(['tech@discopenguin.com', 'keesmaat123@gmail.com'])
  })

  it('keeps an admin who explicitly re-opted in', () => {
    const out = recipientsForWaitlist(admins, [
      { email: 'keesmaat123@gmail.com', waitlistNotify: true },
    ])
    expect(out).toEqual(admins)
  })

  it('matches case/whitespace-insensitively', () => {
    const out = recipientsForWaitlist(admins, [
      { email: '  RONAN@BlueBramble.net ', waitlistNotify: false },
    ])
    expect(out).not.toContain('ronan@bluebramble.net')
    expect(out).toHaveLength(2)
  })

  it('ignores prefs for emails that are not current admins', () => {
    const out = recipientsForWaitlist(admins, [
      { email: 'someone-else@example.com', waitlistNotify: false },
    ])
    expect(out).toEqual(admins)
  })
})
