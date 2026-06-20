import { describe, it, expect } from 'vitest'
import { shapeWaitlist, waitlistRowActions } from './admin-server'
import { ADMIN_EMAIL } from './access-rules'

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
    expect(shapeWaitlist([])).toEqual({
      count: 0,
      rows: [],
      viewerIsSuperAdmin: false,
    })
  })

  it("defaults every row's grant to 'none' when no grant map is given", () => {
    const view = shapeWaitlist([{ email: 'a@b.com', createdAt: 0 }])
    expect(view.rows[0]!.grant).toBe('none')
  })

  it('tags each row with its grant state (case insensitive match)', () => {
    const grants = new Map<string, 'user' | 'admin'>([
      ['dave@x.com', 'user'],
      ['eve@x.com', 'admin'],
    ])
    const view = shapeWaitlist(
      [
        { email: 'Dave@X.com', createdAt: '2026-03-01T00:00:00.000Z' },
        { email: 'eve@x.com', createdAt: '2026-02-01T00:00:00.000Z' },
        { email: 'frank@x.com', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
      grants,
    )
    const byEmail = new Map(view.rows.map((r) => [r.email, r.grant]))
    expect(byEmail.get('Dave@X.com')).toBe('user')
    expect(byEmail.get('eve@x.com')).toBe('admin')
    expect(byEmail.get('frank@x.com')).toBe('none')
  })

  it('defaults to non-revocable rows + viewerIsSuperAdmin false when no viewer', () => {
    const view = shapeWaitlist(
      [{ email: 'admin-grant@x.com', createdAt: 0 }],
      new Map<string, 'user' | 'admin'>([['admin-grant@x.com', 'admin']]),
    )
    expect(view.viewerIsSuperAdmin).toBe(false)
    expect(view.rows[0]!.revocable).toBe(false)
    expect(view.rows[0]!.configAdmin).toBe(false)
  })

  it('a super-admin viewer can revoke a DB-granted admin row', () => {
    const superEmail = 'ronan@ronanconnolly.dev'
    const envAdmins = new Set([superEmail, ADMIN_EMAIL])
    const view = shapeWaitlist(
      [
        { email: 'admin-grant@x.com', createdAt: 3 },
        { email: 'plain-user@x.com', createdAt: 2 },
      ],
      new Map<string, 'user' | 'admin'>([
        ['admin-grant@x.com', 'admin'],
        ['plain-user@x.com', 'user'],
      ]),
      { email: superEmail, isSuperAdmin: true, envAdmins },
    )
    expect(view.viewerIsSuperAdmin).toBe(true)
    const byEmail = new Map(view.rows.map((r) => [r.email, r]))
    expect(byEmail.get('admin-grant@x.com')!.revocable).toBe(true)
    expect(byEmail.get('admin-grant@x.com')!.configAdmin).toBe(false)
    // A plain user is not an admin -> not revocable, not a config admin.
    expect(byEmail.get('plain-user@x.com')!.revocable).toBe(false)
    expect(byEmail.get('plain-user@x.com')!.configAdmin).toBe(false)
  })

  it('tags an env/config admin row (no DB grant) as configAdmin, never revocable', () => {
    const superEmail = 'ronan@ronanconnolly.dev'
    const envAdmins = new Set(['boss@x.com', superEmail, ADMIN_EMAIL])
    const view = shapeWaitlist(
      [{ email: 'boss@x.com', createdAt: 1 }],
      new Map<string, 'user' | 'admin'>(), // no DB grant
      { email: superEmail, isSuperAdmin: true, envAdmins },
    )
    expect(view.rows[0]!.configAdmin).toBe(true)
    expect(view.rows[0]!.revocable).toBe(false)
  })

  it('hides revoke from a non-super-admin viewer', () => {
    const envAdmins = new Set([ADMIN_EMAIL])
    const view = shapeWaitlist(
      [{ email: 'admin-grant@x.com', createdAt: 1 }],
      new Map<string, 'user' | 'admin'>([['admin-grant@x.com', 'admin']]),
      { email: 'boss@x.com', isSuperAdmin: false, envAdmins },
    )
    expect(view.viewerIsSuperAdmin).toBe(false)
    expect(view.rows[0]!.revocable).toBe(false)
  })
})

describe('waitlistRowActions', () => {
  it('not approved, not admin -> Approve as user + Make admin only', () => {
    expect(
      waitlistRowActions({
        grant: 'none',
        configAdmin: false,
        revocable: false,
      }),
    ).toEqual({
      approveAsUser: true,
      makeAdmin: true,
      approvedTag: false,
      adminBadge: false,
      configAdminTag: false,
      removeAdmin: false,
    })
  })

  it('approved user (not admin) -> Approved tag + Make admin, never Approve', () => {
    const a = waitlistRowActions({
      grant: 'user',
      configAdmin: false,
      revocable: false,
    })
    expect(a.approvedTag).toBe(true)
    expect(a.makeAdmin).toBe(true)
    expect(a.approveAsUser).toBe(false)
    expect(a.adminBadge).toBe(false)
    expect(a.configAdminTag).toBe(false)
    expect(a.removeAdmin).toBe(false)
  })

  it('DB-granted admin (super-admin viewer) -> Admin badge + Remove admin, no approve/make-admin', () => {
    const a = waitlistRowActions({
      grant: 'admin',
      configAdmin: false,
      revocable: true,
    })
    expect(a.adminBadge).toBe(true)
    expect(a.removeAdmin).toBe(true)
    expect(a.approveAsUser).toBe(false)
    expect(a.makeAdmin).toBe(false)
    expect(a.configAdminTag).toBe(false)
  })

  it('DB-granted admin (non-super-admin viewer) -> Admin badge only, no Remove', () => {
    const a = waitlistRowActions({
      grant: 'admin',
      configAdmin: false,
      revocable: false,
    })
    expect(a.adminBadge).toBe(true)
    expect(a.removeAdmin).toBe(false)
    expect(a.makeAdmin).toBe(false)
  })

  it('config/owner admin -> Admin badge + config tag, NO action buttons (the #209 bug)', () => {
    // A config admin sits on the waitlist with no DB grant (grant 'none') but
    // configAdmin true. It must NOT offer Approve as user / Make admin.
    const a = waitlistRowActions({
      grant: 'none',
      configAdmin: true,
      revocable: false,
    })
    expect(a.adminBadge).toBe(true)
    expect(a.configAdminTag).toBe(true)
    expect(a.approveAsUser).toBe(false)
    expect(a.makeAdmin).toBe(false)
    expect(a.approvedTag).toBe(false)
    expect(a.removeAdmin).toBe(false)
  })

  it('config admin takes precedence even if the row also has a user grant', () => {
    const a = waitlistRowActions({
      grant: 'user',
      configAdmin: true,
      revocable: false,
    })
    expect(a.adminBadge).toBe(true)
    expect(a.configAdminTag).toBe(true)
    expect(a.makeAdmin).toBe(false)
    expect(a.approvedTag).toBe(false)
  })
})
