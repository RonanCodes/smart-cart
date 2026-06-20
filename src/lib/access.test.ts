import { describe, it, expect } from 'vitest'
import {
  ADMIN_EMAIL,
  parseApprovedList,
  isApprovedIn,
  grantMapFrom,
  isApprovedWith,
  isAdminWith,
  grantStateFor,
  normalizeEmail,
} from './access-rules'

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

describe('grantMapFrom', () => {
  it('normalises emails and drops blanks', () => {
    const m = grantMapFrom([
      { email: ' Dave@X.com ', role: 'user' },
      { email: '', role: 'admin' },
      { email: 'Eve@x.com', role: 'admin' },
    ])
    expect(m.get('dave@x.com')).toBe('user')
    expect(m.get('eve@x.com')).toBe('admin')
    expect(m.size).toBe(2)
  })

  it('later rows win on a duplicate email', () => {
    const m = grantMapFrom([
      { email: 'a@x.com', role: 'user' },
      { email: 'A@X.COM', role: 'admin' },
    ])
    expect(m.get('a@x.com')).toBe('admin')
  })
})

describe('isApprovedWith (env list OR db grant)', () => {
  const approved = parseApprovedList('alice@x.com')

  it('approves the admin email regardless of list / grants', () => {
    expect(isApprovedWith(ADMIN_EMAIL, new Set(), new Map())).toBe(true)
  })

  it('approves an env-listed email even with no grant', () => {
    expect(isApprovedWith('alice@x.com', approved, new Map())).toBe(true)
  })

  it('approves a user-granted email not in the env list', () => {
    const grants = grantMapFrom([{ email: 'dave@x.com', role: 'user' }])
    expect(isApprovedWith('dave@x.com', approved, grants)).toBe(true)
    expect(isApprovedWith('DAVE@X.COM', approved, grants)).toBe(true)
  })

  it('approves an admin-granted email (admin implies approved)', () => {
    const grants = grantMapFrom([{ email: 'eve@x.com', role: 'admin' }])
    expect(isApprovedWith('eve@x.com', approved, grants)).toBe(true)
  })

  it('rejects an email neither listed nor granted', () => {
    expect(isApprovedWith('nobody@x.com', approved, new Map())).toBe(false)
    expect(isApprovedWith('', approved, new Map())).toBe(false)
  })
})

describe('isAdminWith (env admins OR db admin grant)', () => {
  const envAdmins = parseApprovedList('boss@x.com')

  it('admits an env admin', () => {
    expect(isAdminWith('boss@x.com', envAdmins, new Map())).toBe(true)
    expect(isAdminWith('BOSS@X.COM', envAdmins, new Map())).toBe(true)
  })

  it('admits an admin-granted email', () => {
    const grants = grantMapFrom([{ email: 'eve@x.com', role: 'admin' }])
    expect(isAdminWith('eve@x.com', envAdmins, grants)).toBe(true)
  })

  it('does NOT admit a user-granted email (user is not admin)', () => {
    const grants = grantMapFrom([{ email: 'dave@x.com', role: 'user' }])
    expect(isAdminWith('dave@x.com', envAdmins, grants)).toBe(false)
  })

  it('rejects an unknown email', () => {
    expect(isAdminWith('nobody@x.com', envAdmins, new Map())).toBe(false)
    expect(isAdminWith('', envAdmins, new Map())).toBe(false)
  })
})

describe('grantStateFor', () => {
  const grants = grantMapFrom([
    { email: 'dave@x.com', role: 'user' },
    { email: 'eve@x.com', role: 'admin' },
  ])

  it('reports the role for a granted email (case insensitive)', () => {
    expect(grantStateFor('DAVE@X.COM', grants)).toBe('user')
    expect(grantStateFor(' eve@x.com ', grants)).toBe('admin')
  })

  it("reports 'none' for an ungranted / blank email", () => {
    expect(grantStateFor('nobody@x.com', grants)).toBe('none')
    expect(grantStateFor('', grants)).toBe('none')
  })
})

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com')
  })
})
