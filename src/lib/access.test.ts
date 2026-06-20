import { describe, it, expect } from 'vitest'
import { ADMIN_EMAIL, parseApprovedList, isApprovedIn } from './access-rules'

describe('parseApprovedList', () => {
  it('returns an empty set for undefined / null / empty', () => {
    expect(parseApprovedList(undefined).size).toBe(0)
    expect(parseApprovedList(null).size).toBe(0)
    expect(parseApprovedList('').size).toBe(0)
  })

  it('splits, trims, lowercases, and drops blanks', () => {
    const set = parseApprovedList(' A@x.com , b@x.com ,, C@X.COM ')
    expect([...set].sort()).toEqual(['a@x.com', 'b@x.com', 'c@x.com'])
  })
})

describe('isApprovedIn', () => {
  const approved = parseApprovedList('alice@x.com, bob@x.com')

  it('approves the admin email regardless of the list', () => {
    expect(isApprovedIn(ADMIN_EMAIL, new Set())).toBe(true)
    expect(isApprovedIn(ADMIN_EMAIL.toUpperCase(), new Set())).toBe(true)
    expect(isApprovedIn(`  ${ADMIN_EMAIL}  `, new Set())).toBe(true)
  })

  it('approves an email present in the list (case / space insensitive)', () => {
    expect(isApprovedIn('alice@x.com', approved)).toBe(true)
    expect(isApprovedIn('ALICE@X.COM', approved)).toBe(true)
    expect(isApprovedIn('  bob@x.com ', approved)).toBe(true)
  })

  it('rejects an email not in the list', () => {
    expect(isApprovedIn('carol@x.com', approved)).toBe(false)
  })

  it('rejects empty / whitespace input', () => {
    expect(isApprovedIn('', approved)).toBe(false)
    expect(isApprovedIn('   ', approved)).toBe(false)
  })
})
