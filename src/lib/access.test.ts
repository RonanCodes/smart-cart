import { describe, it, expect } from 'vitest'
import {
  ADMIN_EMAIL,
  SUPER_ADMIN_EMAIL,
  parseApprovedList,
  isApprovedIn,
  grantMapFrom,
  isApprovedWith,
  isAdminWith,
  grantStateFor,
  normalizeEmail,
  mergePeople,
  isSuperAdminWith,
  buildSuperAdminSet,
  canRevokeAdmin,
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

describe('buildSuperAdminSet (constant ∪ SUPER_ADMIN_EMAILS secret)', () => {
  it('always includes the SUPER_ADMIN_EMAIL constant, even with an empty secret', () => {
    const set = buildSuperAdminSet(undefined)
    expect(set.has(SUPER_ADMIN_EMAIL)).toBe(true)
    expect(buildSuperAdminSet('').has(SUPER_ADMIN_EMAIL)).toBe(true)
    expect(buildSuperAdminSet(null).has(SUPER_ADMIN_EMAIL)).toBe(true)
  })

  it('with an empty secret, the constant is the ONLY super-admin', () => {
    const set = buildSuperAdminSet(undefined)
    expect(set.size).toBe(1)
    // ronanconnolly.dev is a super-admin; nobody else is.
    expect(isSuperAdminWith(SUPER_ADMIN_EMAIL, set)).toBe(true)
    expect(isSuperAdminWith('someone-else@x.com', set)).toBe(false)
  })

  it('unions the secret with the constant (normalised)', () => {
    const set = buildSuperAdminSet(' Extra@X.com , other@x.com ')
    expect(set.has(SUPER_ADMIN_EMAIL)).toBe(true)
    expect(set.has('extra@x.com')).toBe(true)
    expect(set.has('other@x.com')).toBe(true)
    expect(isSuperAdminWith('EXTRA@X.COM', set)).toBe(true)
  })

  it('ADMIN_EMAIL is ronanconnolly.dev and equals the super-admin constant', () => {
    // The default owner / admin is ronanconnolly.dev, and ronanconnolly.dev is also the
    // always-on super-admin, so the two constants agree.
    expect(ADMIN_EMAIL).toBe('ronan@ronanconnolly.dev')
    expect(SUPER_ADMIN_EMAIL).toBe('ronan@ronanconnolly.dev')
  })
})

describe('isSuperAdminWith', () => {
  const supers = parseApprovedList('ronan@ronanconnolly.dev')

  it('admits an email in the super-admin set (case / space insensitive)', () => {
    expect(isSuperAdminWith('ronan@ronanconnolly.dev', supers)).toBe(true)
    expect(isSuperAdminWith('RONAN@RONANCONNOLLY.DEV', supers)).toBe(true)
    expect(isSuperAdminWith('  ronan@ronanconnolly.dev ', supers)).toBe(true)
  })

  it('rejects an email not in the set, and blanks', () => {
    expect(isSuperAdminWith('boss@x.com', supers)).toBe(false)
    expect(isSuperAdminWith('', supers)).toBe(false)
    expect(isSuperAdminWith('x@y.com', new Set())).toBe(false)
  })
})

describe('canRevokeAdmin (super-admin revoke guard rails)', () => {
  const superEmail = 'ronan@ronanconnolly.dev'
  // Env admin set as admin-server builds it: ADMIN_EMAILS + owner + super-admins.
  const envAdmins = parseApprovedList(`boss@x.com, ${superEmail}`)
  envAdmins.add(ADMIN_EMAIL)

  const base = {
    actorEmail: superEmail,
    actorIsSuperAdmin: true,
    envAdmins,
  }

  it('allows a super-admin to revoke a DB-granted admin', () => {
    expect(
      canRevokeAdmin({
        ...base,
        targetEmail: 'granted-admin@x.com',
        targetGrant: 'admin',
      }),
    ).toBe(true)
    // case-insensitive on the target
    expect(
      canRevokeAdmin({
        ...base,
        targetEmail: 'GRANTED-ADMIN@X.COM',
        targetGrant: 'admin',
      }),
    ).toBe(true)
  })

  it('a non-super-admin can never revoke', () => {
    expect(
      canRevokeAdmin({
        ...base,
        actorIsSuperAdmin: false,
        targetEmail: 'granted-admin@x.com',
        targetGrant: 'admin',
      }),
    ).toBe(false)
  })

  it('a super-admin can NOT revoke themselves', () => {
    // Self would normally be an env config admin too, but assert the self-rule
    // even if they were somehow a DB grant.
    expect(
      canRevokeAdmin({
        ...base,
        targetEmail: superEmail,
        targetGrant: 'admin',
      }),
    ).toBe(false)
  })

  it('can NOT revoke the default owner', () => {
    expect(
      canRevokeAdmin({
        ...base,
        targetEmail: ADMIN_EMAIL,
        targetGrant: 'admin',
      }),
    ).toBe(false)
  })

  it('can NOT revoke an env/config admin (in ADMIN_EMAILS)', () => {
    expect(
      canRevokeAdmin({
        ...base,
        targetEmail: 'boss@x.com',
        targetGrant: 'admin',
      }),
    ).toBe(false)
  })

  it('can NOT revoke a non-admin (no admin grant)', () => {
    expect(
      canRevokeAdmin({
        ...base,
        targetEmail: 'someone@x.com',
        targetGrant: 'user',
      }),
    ).toBe(false)
    expect(
      canRevokeAdmin({
        ...base,
        targetEmail: 'someone@x.com',
        targetGrant: 'none',
      }),
    ).toBe(false)
  })

  it('rejects blank actor / target', () => {
    expect(
      canRevokeAdmin({
        ...base,
        actorEmail: '',
        targetEmail: 'a@x.com',
        targetGrant: 'admin',
      }),
    ).toBe(false)
    expect(
      canRevokeAdmin({ ...base, targetEmail: '', targetGrant: 'admin' }),
    ).toBe(false)
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

  it('marks DB-granted admins revocable for a super-admin, and config admins not', () => {
    const superEmail = 'ronan@ronanconnolly.dev'
    const envAdmins = parseApprovedList(`${superEmail}`)
    envAdmins.add(ADMIN_EMAIL)
    const out = mergePeople<B>({
      userRows: [],
      envAdmins,
      envApproved: new Set(),
      grants: grantMapFrom([{ email: 'granted-admin@x.com', role: 'admin' }]),
      viewerEmail: superEmail,
      viewerIsSuperAdmin: true,
    })
    const granted = out.find((p) => p.email === 'granted-admin@x.com')!
    expect(granted.isAdmin).toBe(true)
    expect(granted.configAdmin).toBe(false)
    expect(granted.revocable).toBe(true)

    const owner = out.find((p) => p.email === ADMIN_EMAIL)!
    expect(owner.isAdmin).toBe(true)
    expect(owner.configAdmin).toBe(true) // env/owner, no DB grant
    expect(owner.revocable).toBe(false)

    const self = out.find((p) => p.email === superEmail)!
    expect(self.configAdmin).toBe(true)
    expect(self.revocable).toBe(false) // never self
  })

  it('never marks rows revocable when the viewer is not a super-admin', () => {
    const out = mergePeople<B>({
      userRows: [],
      envAdmins: new Set(),
      envApproved: new Set(),
      grants: grantMapFrom([{ email: 'granted-admin@x.com', role: 'admin' }]),
      viewerEmail: 'boss@x.com',
      viewerIsSuperAdmin: false,
    })
    expect(out.find((p) => p.email === 'granted-admin@x.com')!.revocable).toBe(
      false,
    )
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
