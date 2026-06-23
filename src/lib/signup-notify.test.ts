import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyAdminsOfNewUser } from './waitlist-notify'

// The real-account-creation notifier (wired into Better Auth's
// databaseHooks.user.create.after). Mirrors notifyAdminsOfSignup but counts the
// `user` table (real accounts) and sends the new-user email. Mocks keep it off
// D1 and Resend so we assert exactly which admins get notified.

const sendNewUserNotice = vi.fn().mockResolvedValue({ sent: true })
const resolveAdminEmails = vi.fn()
let storedPrefs: Array<{ email: string; waitlistNotify: boolean }> = []
let userCount = 0

function buildFakeDb() {
  // Two selects: count(*) from user, then the prefs rows. Distinguished by the
  // requested column shape, same trick as waitlist-notify.test.ts.
  return {
    select: (cols: Record<string, unknown>) => ({
      from: async () => ('n' in cols ? [{ n: userCount }] : storedPrefs),
    }),
  }
}

vi.mock('../db/client', () => ({ getDb: async () => buildFakeDb() }))
vi.mock('../db/auth-schema', () => ({
  user: { id: 'id-col', email: 'email-col' },
}))
vi.mock('../db/admin-prefs-schema', () => ({
  adminNotificationPref: { email: 'email-col', waitlistNotify: 'notify-col' },
}))
vi.mock('./admin-emails', () => ({
  resolveAdminEmails: () => resolveAdminEmails(),
}))
vi.mock('./email', () => ({
  sendNewUserNotice: (email: string, total: number, to: string) =>
    sendNewUserNotice(email, total, to),
  // The notifier now also destructures sendMilestoneEmail; these tests use
  // non-milestone counts so it is never invoked, but it must exist on the mock
  // so the destructure does not pull undefined.
  sendMilestoneEmail: vi.fn().mockResolvedValue({ sent: true }),
}))

describe('notifyAdminsOfNewUser', () => {
  beforeEach(() => {
    sendNewUserNotice.mockClear().mockResolvedValue({ sent: true })
    resolveAdminEmails.mockReset()
    storedPrefs = []
    userCount = 0
  })

  it('emails every opted-in admin with the new email + total user count', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com', 'b@admin.com'])
    storedPrefs = [] // default-on
    userCount = 12

    await notifyAdminsOfNewUser('new@user.com')

    expect(sendNewUserNotice).toHaveBeenCalledTimes(2)
    const recipients = sendNewUserNotice.mock.calls.map((c) => c[2])
    expect(recipients).toEqual(
      expect.arrayContaining(['a@admin.com', 'b@admin.com']),
    )
    expect(sendNewUserNotice).toHaveBeenCalledWith(
      'new@user.com',
      12,
      expect.any(String),
    )
  })

  it('skips an admin who opted out (waitlistNotify: false)', async () => {
    resolveAdminEmails.mockResolvedValue(['a@admin.com', 'b@admin.com'])
    storedPrefs = [{ email: 'b@admin.com', waitlistNotify: false }]

    await notifyAdminsOfNewUser('new@user.com')

    expect(sendNewUserNotice).toHaveBeenCalledTimes(1)
    expect(sendNewUserNotice.mock.calls[0]![2]).toBe('a@admin.com')
  })

  it('is non-fatal: an upstream failure is swallowed, never thrown', async () => {
    resolveAdminEmails.mockRejectedValue(new Error('env unavailable'))

    await expect(notifyAdminsOfNewUser('new@user.com')).resolves.toBeUndefined()
    expect(sendNewUserNotice).not.toHaveBeenCalled()
  })
})
