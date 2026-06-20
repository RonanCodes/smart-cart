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
  // `returned` is what .returning() resolves to: a non-empty array means a row
  // was actually inserted; an empty array means onConflictDoNothing no-op'd.
  function mockDb(returned: Array<{ id: string }> = [{ id: 'new-row' }]) {
    const returning = vi.fn().mockResolvedValue(returned)
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning })
    const values = vi.fn().mockReturnValue({ onConflictDoNothing })
    const insert = vi.fn().mockReturnValue({ values })
    return {
      db: { insert } as never,
      insert,
      values,
      onConflictDoNothing,
      returning,
    }
  }

  it('inserts the email with a generated id and reports a new insert', async () => {
    const m = mockDb([{ id: 'new-row' }])
    const result = await upsertWaitlistEmail(m.db, 'a@b.com')

    expect(result).toEqual({ ok: true, inserted: true })
    expect(m.insert).toHaveBeenCalledOnce()
    const row = m.values.mock.calls[0]![0]
    expect(row.email).toBe('a@b.com')
    expect(typeof row.id).toBe('string')
    expect(row.id.length).toBeGreaterThan(0)
  })

  it('reports inserted:false when the email is a duplicate (returning is empty)', async () => {
    const m = mockDb([])
    const result = await upsertWaitlistEmail(m.db, 'a@b.com')
    expect(result).toEqual({ ok: true, inserted: false })
  })

  it('is idempotent: uses onConflictDoNothing so a repeat submit never throws', async () => {
    const m = mockDb()
    await upsertWaitlistEmail(m.db, 'a@b.com')
    await upsertWaitlistEmail(m.db, 'a@b.com')
    expect(m.onConflictDoNothing).toHaveBeenCalledTimes(2)
  })
})
