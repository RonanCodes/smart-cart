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
  // `existing` is what the SELECT-before-insert resolves to: a non-empty array
  // means the email is already on the list (a duplicate), an empty array means
  // it's genuinely new. This is the deterministic signal we use instead of
  // .returning() (unreliable on D1). `.returning()` is still wired so the insert
  // chain type-checks, but its result is ignored for the new flag.
  function mockDb(existing: Array<{ id: string }> = []) {
    const returning = vi.fn().mockResolvedValue([])
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning })
    const values = vi.fn().mockReturnValue({ onConflictDoNothing })
    const insert = vi.fn().mockReturnValue({ values })

    const limit = vi.fn().mockResolvedValue(existing)
    const where = vi.fn().mockReturnValue({ limit })
    const from = vi.fn().mockReturnValue({ where })
    const select = vi.fn().mockReturnValue({ from })

    return {
      db: { select, insert } as never,
      select,
      from,
      where,
      limit,
      insert,
      values,
      onConflictDoNothing,
      returning,
    }
  }

  it('inserts the email with a generated id and reports a new insert (email not yet present)', async () => {
    const m = mockDb([]) // SELECT finds nothing => new
    const result = await upsertWaitlistEmail(m.db, 'a@b.com')

    expect(result).toEqual({ ok: true, inserted: true })
    expect(m.insert).toHaveBeenCalledOnce()
    const row = m.values.mock.calls[0]![0]
    expect(row.email).toBe('a@b.com')
    expect(typeof row.id).toBe('string')
    expect(row.id.length).toBeGreaterThan(0)
  })

  it('reports inserted:false when the email already exists (SELECT finds a row)', async () => {
    const m = mockDb([{ id: 'existing-row' }])
    const result = await upsertWaitlistEmail(m.db, 'a@b.com')
    expect(result).toEqual({ ok: true, inserted: false })
  })

  it('does not depend on .returning() for the new flag: empty returning still reports inserted:true on a new email', async () => {
    // Mirrors the D1 bug: a genuine insert whose RETURNING yields no rows.
    const m = mockDb([]) // SELECT: not present => new
    m.returning.mockResolvedValue([]) // RETURNING: empty even though it inserted
    const result = await upsertWaitlistEmail(m.db, 'a@b.com')
    expect(result).toEqual({ ok: true, inserted: true })
  })

  it('is idempotent: uses onConflictDoNothing so a repeat submit never throws', async () => {
    const m = mockDb([])
    await upsertWaitlistEmail(m.db, 'a@b.com')
    await upsertWaitlistEmail(m.db, 'a@b.com')
    expect(m.onConflictDoNothing).toHaveBeenCalledTimes(2)
  })
})
