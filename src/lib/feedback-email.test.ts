import { describe, it, expect } from 'vitest'
import {
  feedbackSentryUrl,
  feedbackContactLine,
  feedbackNoticeText,
  feedbackNoticeHtml,
} from './feedback-email'

describe('feedbackSentryUrl', () => {
  it('builds an org-scoped de.sentry.io issue search for an event id', () => {
    const url = feedbackSentryUrl('abc123')
    expect(url).toBe('https://ronan-connolly.de.sentry.io/souso/?query=abc123')
  })

  it('returns null when there is no event id (degrade gracefully)', () => {
    expect(feedbackSentryUrl(null)).toBeNull()
    expect(feedbackSentryUrl(undefined)).toBeNull()
    expect(feedbackSentryUrl('   ')).toBeNull()
  })

  it('url-encodes the event id', () => {
    expect(feedbackSentryUrl('a b/c')).toContain('query=a%20b%2Fc')
  })
})

describe('feedbackContactLine', () => {
  it('joins email and phone with a separator', () => {
    expect(feedbackContactLine({ email: 'a@b.com', phone: '+31 6 12' })).toBe(
      'a@b.com · +31 6 12',
    )
  })

  it('falls back to "no contact left" when both are missing', () => {
    expect(feedbackContactLine({})).toBe('no contact left')
    expect(feedbackContactLine({ email: null, phone: null })).toBe(
      'no contact left',
    )
  })
})

describe('feedbackNoticeText', () => {
  const at = new Date('2026-06-22T07:30:00Z')

  it('includes the message, contact, and a submitted-at timestamp', () => {
    const body = feedbackNoticeText({
      message: 'the swap button is hard to find',
      email: 'nico@example.com',
      submittedAt: at,
    })
    expect(body).toContain('the swap button is hard to find')
    expect(body).toContain('Contact: nico@example.com')
    expect(body).toContain('Submitted: 2026-06-22 07:30:00 UTC')
  })

  it('includes a Sentry link when an event id is present', () => {
    const body = feedbackNoticeText({
      message: 'broken',
      sentryEventId: 'evt_9',
      submittedAt: at,
    })
    expect(body).toContain(
      'Sentry: https://ronan-connolly.de.sentry.io/souso/?query=evt_9',
    )
  })

  it('omits the Sentry line when there is no event id (never throws)', () => {
    const body = feedbackNoticeText({
      message: 'no sentry here',
      submittedAt: at,
    })
    expect(body).not.toContain('Sentry:')
    expect(body).toContain('Submitted:')
  })

  it('still renders a timestamp when none is passed', () => {
    const body = feedbackNoticeText({ message: 'hi' })
    expect(body).toMatch(/Submitted: \d{4}-\d{2}-\d{2} /)
  })
})

describe('feedbackNoticeHtml', () => {
  const at = new Date('2026-06-22T07:30:00Z')

  it('renders the timestamp and a real Sentry anchor when present', () => {
    const html = feedbackNoticeHtml({
      message: 'broken',
      sentryEventId: 'evt_9',
      submittedAt: at,
    })
    expect(html).toContain('Submitted: 2026-06-22 07:30:00 UTC')
    expect(html).toContain(
      'href="https://ronan-connolly.de.sentry.io/souso/?query=evt_9"',
    )
  })

  it('omits the Sentry anchor when no event id (degrade gracefully)', () => {
    const html = feedbackNoticeHtml({ message: 'hi', submittedAt: at })
    expect(html).not.toContain('href="https://ronan-connolly')
    expect(html).toContain('Submitted:')
  })

  it('escapes html in the message', () => {
    const html = feedbackNoticeHtml({
      message: '<script>alert(1)</script>',
      submittedAt: at,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
