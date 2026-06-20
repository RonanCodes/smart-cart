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
  mergePeople,
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

describe('mergePeople (union user rows + env admins + env approved + grants)', () => {
  type B = { emoji: string; label: string }
  const userRow = (
    over: Partial<{
      userId: string
      email: string
      householdId: string | null
      swipes: number
      badges: Array<B>
    }> = {},
  ) => ({
    userId: 'u1',
    email: 'onboarded@x.com',
    householdId: 'h1',
    swipes: 5,
    badges: [{ emoji: '🍝', label: 'Pasta person' }] as Array<B>,
    ...over,
  })

  it('keeps a real onboarded user (has household) with swipes + badges', () => {
    const out = mergePeople<B>({
      userRows: [userRow()],
      envAdmins: new Set(),
      envApproved: new Set(),
      grants: new Map(),
    })
    const p = out.find((x) => x.email === 'onboarded@x.com')!
    expect(p.userId).toBe('u1')
    expect(p.householdId).toBe('h1')
    expect(p.swipes).toBe(5)
    expect(p.onboarded).toBe(true)
    expect(p.isAdmin).toBe(false)
    expect(p.access).toBe('none') // real row, no grant/env entry
  })

  it('a signed-in user with no household is NOT onboarded', () => {
    const out = mergePeople<B>({
      userRows: [userRow({ householdId: null, swipes: 0, badges: [] })],
      envAdmins: new Set(),
      envApproved: new Set(),
      grants: new Map(),
    })
    expect(out[0]!.onboarded).toBe(false)
  })

  it('includes env admins / approved / grants who have NO user row', () => {
    const out = mergePeople<B>({
      userRows: [],
      envAdmins: parseApprovedList('boss@x.com'),
      envApproved: parseApprovedList('approved@x.com'),
      grants: grantMapFrom([{ email: 'granted@x.com', role: 'user' }]),
    })
    const emails = out.map((p) => p.email)
    expect(emails).toContain('boss@x.com')
    expect(emails).toContain('approved@x.com')
    expect(emails).toContain('granted@x.com')
    for (const p of out) {
      expect(p.userId).toBeNull()
      expect(p.householdId).toBeNull()
      expect(p.swipes).toBe(0)
      expect(p.onboarded).toBe(false)
    }
  })

  it('flags admins (env admin OR admin grant) with isAdmin + access=admin', () => {
    const out = mergePeople<B>({
      userRows: [userRow({ email: 'boss@x.com', userId: 'u9' })],
      envAdmins: parseApprovedList('boss@x.com'),
      envApproved: new Set(),
      grants: grantMapFrom([{ email: 'grantedadmin@x.com', role: 'admin' }]),
    })
    const boss = out.find((p) => p.email === 'boss@x.com')!
    expect(boss.isAdmin).toBe(true)
    expect(boss.access).toBe('admin')
    const ga = out.find((p) => p.email === 'grantedadmin@x.com')!
    expect(ga.isAdmin).toBe(true)
    expect(ga.access).toBe('admin')
  })

  it('classifies env-approved / user-granted as access=user (not admin)', () => {
    const out = mergePeople<B>({
      userRows: [],
      envAdmins: new Set(),
      envApproved: parseApprovedList('approved@x.com'),
      grants: grantMapFrom([{ email: 'granteduser@x.com', role: 'user' }]),
    })
    expect(out.find((p) => p.email === 'approved@x.com')!.access).toBe('user')
    expect(out.find((p) => p.email === 'approved@x.com')!.isAdmin).toBe(false)
    expect(out.find((p) => p.email === 'granteduser@x.com')!.access).toBe(
      'user',
    )
  })

  it('de-dupes by normalised email, merging the user row onto the env entry', () => {
    const out = mergePeople<B>({
      userRows: [userRow({ email: 'Boss@X.com', userId: 'u9' })],
      envAdmins: parseApprovedList('boss@x.com'),
      envApproved: new Set(),
      grants: new Map(),
    })
    const matches = out.filter((p) => p.email === 'boss@x.com')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.userId).toBe('u9') // user row carried through
    expect(matches[0]!.isAdmin).toBe(true) // env admin claim applied
    expect(matches[0]!.email).toBe('boss@x.com') // normalised
  })

  it('sorts admins first, then onboarded users, then the rest (alpha within)', () => {
    const out = mergePeople<B>({
      userRows: [
        userRow({ email: 'zed@x.com', userId: 'uz', householdId: 'hz' }), // onboarded
        userRow({
          email: 'newbie@x.com',
          userId: 'un',
          householdId: null,
          swipes: 0,
          badges: [],
        }), // signed in, not onboarded
      ],
      envAdmins: parseApprovedList('boss@x.com'),
      envApproved: new Set(),
      grants: new Map(),
    })
    expect(out.map((p) => p.email)).toEqual([
      'boss@x.com', // admin
      'zed@x.com', // onboarded
      'newbie@x.com', // neither
    ])
  })
})
