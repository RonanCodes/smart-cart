import { describe, it, expect, vi } from 'vitest'
import { normalizeWaitlistEmail, upsertWaitlistEmail } from './waitlist-server'

describe('normalizeWaitlistEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeWaitlistEmail('  Foo@Bar.COM ')).toBe('foo@bar.com')
  })

  it('throws on a value with no @', () => {
    expect(() => normalizeWaitlistEmail('not-an-email')).toThrow()
  })

  it('throws on empty input', () => {
    expect(() => normalizeWaitlistEmail('   ')).toThrow()
  })
})

describe('upsertWaitlistEmail', () => {
  function mockDb() {
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn().mockReturnValue({ onConflictDoNothing })
    const insert = vi.fn().mockReturnValue({ values })
    return {
      db: { insert } as never,
      insert,
      values,
      onConflictDoNothing,
    }
  }

  it('inserts the email with a generated id and returns ok', async () => {
    const m = mockDb()
    const result = await upsertWaitlistEmail(m.db, 'a@b.com')

    expect(result).toEqual({ ok: true })
    expect(m.insert).toHaveBeenCalledOnce()
    const row = m.values.mock.calls[0]![0]
    expect(row.email).toBe('a@b.com')
    expect(typeof row.id).toBe('string')
    expect(row.id.length).toBeGreaterThan(0)
  })

  it('is idempotent: uses onConflictDoNothing so a repeat submit never throws', async () => {
    const m = mockDb()
    await upsertWaitlistEmail(m.db, 'a@b.com')
    await upsertWaitlistEmail(m.db, 'a@b.com')
    expect(m.onConflictDoNothing).toHaveBeenCalledTimes(2)
  })
})
