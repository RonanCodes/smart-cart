import { describe, it, expect } from 'vitest'
import {
  shapeSentryFeedback,
  sentryFeedbackUrl,
  sentryEventUrl,
} from './sentry-admin'

describe('shapeSentryFeedback', () => {
  it('returns [] for a non-array payload (never throws)', () => {
    expect(shapeSentryFeedback(null)).toEqual([])
    expect(shapeSentryFeedback(undefined)).toEqual([])
    expect(shapeSentryFeedback({ detail: 'forbidden' })).toEqual([])
    expect(shapeSentryFeedback('oops')).toEqual([])
  })

  it('maps a well-formed feedback entry', () => {
    const out = shapeSentryFeedback([
      {
        id: 'fb_1',
        name: 'Sanne',
        email: 'sanne@example.com',
        comments: 'The swap button is hard to find',
        dateCreated: '2026-06-20T10:00:00Z',
        eventID: 'abc123',
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!).toEqual({
      id: 'fb_1',
      name: 'Sanne',
      email: 'sanne@example.com',
      comments: 'The swap button is hard to find',
      createdAtMs: Date.parse('2026-06-20T10:00:00Z'),
      eventID: 'abc123',
    })
  })

  it('drops entries with no comment text (noise)', () => {
    const out = shapeSentryFeedback([
      { id: '1', comments: '   ' },
      { id: '2', comments: 'real one' },
      { id: '3' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.comments).toBe('real one')
  })

  it('tolerates missing optional fields', () => {
    const out = shapeSentryFeedback([{ id: 'x', comments: 'hi' }])
    expect(out[0]!.name).toBeNull()
    expect(out[0]!.email).toBeNull()
    expect(out[0]!.eventID).toBeNull()
    expect(out[0]!.createdAtMs).toBeNull()
  })

  it('synthesises an id when Sentry omits it', () => {
    const out = shapeSentryFeedback([{ comments: 'no id here' }])
    expect(out[0]!.id).toMatch(/.+/)
  })

  it('sorts newest first, dateless entries last', () => {
    const out = shapeSentryFeedback([
      { id: 'old', comments: 'old', dateCreated: '2026-01-01T00:00:00Z' },
      { id: 'new', comments: 'new', dateCreated: '2026-06-01T00:00:00Z' },
      { id: 'none', comments: 'none' },
    ])
    expect(out.map((i) => i.id)).toEqual(['new', 'old', 'none'])
  })

  it('ignores junk dates rather than throwing', () => {
    const out = shapeSentryFeedback([
      { id: 'j', comments: 'junk date', dateCreated: 'not-a-date' },
    ])
    expect(out[0]!.createdAtMs).toBeNull()
  })
})

describe('sentryFeedbackUrl', () => {
  it('builds the project user-feedback endpoint', () => {
    expect(
      sentryFeedbackUrl({
        host: 'de.sentry.io',
        org: 'ronan-connolly',
        project: 'souso',
      }),
    ).toBe(
      'https://de.sentry.io/api/0/projects/ronan-connolly/souso/user-feedback/',
    )
  })
})

describe('sentryEventUrl', () => {
  it('returns null with no eventID', () => {
    expect(
      sentryEventUrl({
        host: 'de.sentry.io',
        org: 'ronan-connolly',
        project: 'souso',
        eventID: null,
      }),
    ).toBeNull()
  })

  it('builds an org-scoped event search link', () => {
    expect(
      sentryEventUrl({
        host: 'de.sentry.io',
        org: 'ronan-connolly',
        project: 'souso',
        eventID: 'abc 123',
      }),
    ).toBe('https://ronan-connolly.de.sentry.io/souso/?query=abc%20123')
  })
})
