import { describe, it, expect } from 'vitest'
import { shapeInboundEmails } from './inbound-email'

describe('shapeInboundEmails', () => {
  it('returns [] for a non-array / non-envelope payload (never throws)', () => {
    expect(shapeInboundEmails(null)).toEqual([])
    expect(shapeInboundEmails(undefined)).toEqual([])
    expect(shapeInboundEmails({ message: 'not found' })).toEqual([])
    expect(shapeInboundEmails('oops')).toEqual([])
  })

  it('reads the { data: [...] } envelope Resend wraps the list in', () => {
    const out = shapeInboundEmails({
      object: 'list',
      has_more: false,
      data: [
        {
          id: 'em_1',
          from: 'sanne@example.com',
          to: ['hello@souso.app'],
          subject: 'Question about my basket',
          created_at: '2026-06-20T10:00:00Z',
        },
      ],
    })
    expect(out).toHaveLength(1)
    expect(out[0]!).toEqual({
      id: 'em_1',
      from: 'sanne@example.com',
      to: ['hello@souso.app'],
      subject: 'Question about my basket',
      createdAtMs: Date.parse('2026-06-20T10:00:00Z'),
    })
  })

  it('also accepts a bare array', () => {
    const out = shapeInboundEmails([
      { id: 'em_2', from: 'a@b.com', to: 'hello@souso.app', subject: 'hi' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.to).toEqual(['hello@souso.app'])
  })

  it('tolerates missing optional fields', () => {
    const out = shapeInboundEmails([{ id: 'x' }])
    expect(out[0]!.from).toBeNull()
    expect(out[0]!.subject).toBeNull()
    expect(out[0]!.to).toEqual([])
    expect(out[0]!.createdAtMs).toBeNull()
  })

  it('synthesises an id when Resend omits it', () => {
    const out = shapeInboundEmails([{ subject: 'no id' }])
    expect(out[0]!.id).toMatch(/.+/)
  })

  it('sorts newest first, dateless entries last', () => {
    const out = shapeInboundEmails([
      { id: 'old', created_at: '2026-01-01T00:00:00Z' },
      { id: 'new', created_at: '2026-06-01T00:00:00Z' },
      { id: 'none' },
    ])
    expect(out.map((i) => i.id)).toEqual(['new', 'old', 'none'])
  })

  it('ignores junk dates rather than throwing', () => {
    const out = shapeInboundEmails([{ id: 'j', created_at: 'not-a-date' }])
    expect(out[0]!.createdAtMs).toBeNull()
  })
})
