import { describe, it, expect } from 'vitest'
import {
  normaliseFeedback,
  normaliseFeedbackPhone,
  feedbackEmailState,
  MAX_FEEDBACK_LENGTH,
  FEEDBACK_CONTACT_EMAIL,
} from './app-feedback'

describe('normaliseFeedback', () => {
  it('accepts a real message and trims it', () => {
    const r = normaliseFeedback({
      message: '  the swap button is hard to find  ',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.message).toBe('the swap button is hard to find')
      expect(r.value.email).toBeNull()
      expect(r.value.source).toBe('tab-bar')
      expect(r.value.path).toBeNull()
    }
  })

  it('rejects an empty message', () => {
    const r = normaliseFeedback({ message: '' })
    expect(r.ok).toBe(false)
  })

  it('rejects a whitespace-only message', () => {
    const r = normaliseFeedback({ message: '   \n\t ' })
    expect(r.ok).toBe(false)
  })

  it('rejects a single-character message (below the floor)', () => {
    const r = normaliseFeedback({ message: 'x' })
    expect(r.ok).toBe(false)
  })

  it('keeps an optional valid email', () => {
    const r = normaliseFeedback({
      message: 'love it',
      email: '  nico@example.com ',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.email).toBe('nico@example.com')
  })

  it('allows a blank email (email is optional)', () => {
    const r = normaliseFeedback({ message: 'great app', email: '   ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.email).toBeNull()
  })

  it('rejects a malformed email', () => {
    const r = normaliseFeedback({ message: 'great app', email: 'not-an-email' })
    expect(r.ok).toBe(false)
  })

  it('keeps the settings source and the path', () => {
    const r = normaliseFeedback({
      message: 'a note from settings',
      source: 'settings',
      path: '/profile',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.source).toBe('settings')
      expect(r.value.path).toBe('/profile')
    }
  })

  it('defaults an unknown source to tab-bar', () => {
    const r = normaliseFeedback({
      message: 'hi',
      // @ts-expect-error testing a bad source value at the boundary
      source: 'spaceship',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.source).toBe('tab-bar')
  })

  it('keeps the tab-bar source', () => {
    const r = normaliseFeedback({ message: 'from the FAB', source: 'tab-bar' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.source).toBe('tab-bar')
  })

  it('keeps the sign-in source (blocked-at-login feedback)', () => {
    const r = normaliseFeedback({
      message: 'I cannot get a code',
      source: 'sign-in',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.source).toBe('sign-in')
  })

  it('clamps an over-long message to the cap', () => {
    const long = 'a'.repeat(MAX_FEEDBACK_LENGTH + 500)
    const r = normaliseFeedback({ message: long })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.message.length).toBe(MAX_FEEDBACK_LENGTH)
  })

  it('exposes a real contact email for the fallback', () => {
    expect(FEEDBACK_CONTACT_EMAIL).toMatch(/@souso\.app$/)
  })

  it('keeps a plausible phone number, trimmed', () => {
    const r = normaliseFeedback({
      message: 'happy to chat',
      phone: '  +31 6 12 34 56 78  ',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.phone).toBe('+31 6 12 34 56 78')
  })

  it('drops a too-short / blank phone to null (never rejects)', () => {
    const r = normaliseFeedback({ message: 'a note', phone: '123' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.phone).toBeNull()

    const blank = normaliseFeedback({ message: 'a note', phone: '   ' })
    expect(blank.ok).toBe(true)
    if (blank.ok) expect(blank.value.phone).toBeNull()
  })

  it('defaults phone to null when omitted', () => {
    const r = normaliseFeedback({ message: 'no number here' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.phone).toBeNull()
  })
})

describe('normaliseFeedbackPhone', () => {
  it('returns null for empty / nullish / too-short input', () => {
    expect(normaliseFeedbackPhone(null)).toBeNull()
    expect(normaliseFeedbackPhone(undefined)).toBeNull()
    expect(normaliseFeedbackPhone('   ')).toBeNull()
    expect(normaliseFeedbackPhone('12345')).toBeNull()
  })

  it('keeps a plausible number with its formatting', () => {
    expect(normaliseFeedbackPhone(' 06-12345678 ')).toBe('06-12345678')
    expect(normaliseFeedbackPhone('+31 6 1234 5678')).toBe('+31 6 1234 5678')
  })
})

describe('feedbackEmailState', () => {
  it('prefills + locks read-only when a session email exists', () => {
    const s = feedbackEmailState('nico@example.com')
    expect(s.value).toBe('nico@example.com')
    expect(s.readOnly).toBe(true)
  })

  it('trims the session email', () => {
    const s = feedbackEmailState('  nico@example.com  ')
    expect(s.value).toBe('nico@example.com')
    expect(s.readOnly).toBe(true)
  })

  it('is editable + empty when signed out (null / undefined / blank)', () => {
    for (const input of [null, undefined, '   ']) {
      const s = feedbackEmailState(input)
      expect(s.value).toBe('')
      expect(s.readOnly).toBe(false)
    }
  })
})
