import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyAdminsOfSignup } from './waitlist-notify'

// Mocks for the server-only modules notifyAdminsOfSignup imports dynamically.
// We control the admin list, the stored prefs, and the Resend send so the test
// asserts exactly which addresses get a notice without touching D1 or Resend.

const sendWaitlistSignupNotice = vi.fn().mockResolvedValue({ sent: true })
const resolveAdminEmails = vi.fn()
// Stored admin_notification_pref rows; default-on means an admin with no row
// still receives. We feed the rows the count/prefs SELECTs resolve to.
let storedPrefs: Array<{ email: string; waitlistNotify: boolean }> = []
let totalCount = 0

function buildFakeDb() {
  // notifyAdminsOfSignup runs two selects: count(*) then the prefs rows.
  // The first select resolves to [{ n }], the second to the prefs rows. We
  // distinguish by the column shape requested.
  return {
    select: (cols: Record<string, unknown>) => ({
      from: async () => ('n' in cols ? [{ n: totalCount }] : storedPrefs),
    }),
  }
}

vi.mock('../db/client', () => ({ getDb: async () => buildFakeDb() }))
vi.mock('../db/admin-prefs-schema', () => ({
  adminNotificationPref: { email: 'email-col', waitlistNotify: 'notify-col' },
}))
vi.mock('./admin-emails', () => ({
  resolveAdminEmails: () => resolveAdminEmails(),
}))
vi.mock('./email', () => ({
  sendWaitlistSignupNotice: (to: string, total: number, addr: string) =>
    sendWaitlistSignupNotice(to, total, addr),
}))
// admin-prefs is a pure helper, no env/db, so use the real implementation.

describe('notifyAdminsOfSignup', () => {
  beforeEach(() => {
    sendWaitlistSignupNotice.mockClear()
    sendWaitlistSignupNotice.mockResolvedValue({ sent: true })
    resolveAdminEmails.mockReset()
    storedPrefs = []
    totalCount = 0
  })

  it('sends to every opted-in admin (default-on: admins with no row receive)', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com', 'b@admin.com'])
    storedPrefs = [] // no rows => both default-on
    totalCount = 6

    await notifyAdminsOfSignup('new@user.com')

    expect(sendWaitlistSignupNotice).toHaveBeenCalledTimes(2)
    const recipients = sendWaitlistSignupNotice.mock.calls.map((c) => c[2])
    expect(recipients).toEqual(
      expect.arrayContaining(['a@admin.com', 'b@admin.com']),
    )
    // Passes the new email + running total through.
    expect(sendWaitlistSignupNotice).toHaveBeenCalledWith(
      'new@user.com',
      6,
      expect.any(String),
    )
  })

  it('skips an admin who opted out (waitlistNotify: false)', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com', 'b@admin.com'])
    storedPrefs = [{ email: 'b@admin.com', waitlistNotify: false }]

    await notifyAdminsOfSignup('new@user.com')

    expect(sendWaitlistSignupNotice).toHaveBeenCalledTimes(1)
    expect(sendWaitlistSignupNotice.mock.calls[0]![2]).toBe('a@admin.com')
  })

  it('is non-fatal: a send throwing for one admin does not stop the rest', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com', 'b@admin.com'])
    sendWaitlistSignupNotice
      .mockRejectedValueOnce(new Error('resend down'))
      .mockResolvedValueOnce({ sent: true })

    await expect(notifyAdminsOfSignup('new@user.com')).resolves.toBeUndefined()
    expect(sendWaitlistSignupNotice).toHaveBeenCalledTimes(2)
  })

  it('is non-fatal: a DB failure is swallowed, never thrown', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com'])
    // Make the admin-emails resolve throw to simulate an upstream failure.
    resolveAdminEmails.mockRejectedValue(new Error('env unavailable'))

    await expect(notifyAdminsOfSignup('new@user.com')).resolves.toBeUndefined()
    expect(sendWaitlistSignupNotice).not.toHaveBeenCalled()
  })
})
