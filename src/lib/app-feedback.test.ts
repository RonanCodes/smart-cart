import { describe, it, expect } from 'vitest'
import {
  normaliseFeedback,
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
      expect(r.value.source).toBe('bubble')
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

  it('defaults an unknown source to bubble', () => {
    const r = normaliseFeedback({
      message: 'hi',
      // @ts-expect-error testing a bad source value at the boundary
      source: 'spaceship',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.source).toBe('bubble')
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
})
