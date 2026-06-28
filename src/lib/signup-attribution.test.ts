import { describe, it, expect } from 'vitest'
import {
  sourceLabel,
  attributionNoticeLines,
  attributionRowFromDraft,
  newUserNoticeText,
} from './signup-attribution'

describe('sourceLabel', () => {
  it('maps each known bucket to its display label', () => {
    expect(sourceLabel('linkedin')).toBe('LinkedIn')
    expect(sourceLabel('tiktok')).toBe('TikTok')
    expect(sourceLabel('instagram')).toBe('Instagram')
    expect(sourceLabel('word_of_mouth')).toBe('Word of mouth')
    expect(sourceLabel('other')).toBe('Other')
  })

  it('reads an unknown / empty bucket as not provided', () => {
    expect(sourceLabel('')).toBe('not provided')
    expect(sourceLabel(null)).toBe('not provided')
    expect(sourceLabel(undefined)).toBe('not provided')
    expect(sourceLabel('martians')).toBe('not provided')
  })
})

describe('attributionNoticeLines', () => {
  it('shows the source label and the referrer when both are given', () => {
    const lines = attributionNoticeLines({
      source: 'linkedin',
      sourceOther: '',
      referrer: 'Ronan',
    })
    expect(lines).toContain('Source: LinkedIn')
    expect(lines).toContain('Referred by: Ronan')
  })

  it('uses the Other free text in the source line when source is other', () => {
    const lines = attributionNoticeLines({
      source: 'other',
      sourceOther: 'a poster at the gym',
      referrer: '',
    })
    expect(lines).toContain('Source: Other (a poster at the gym)')
  })

  it('says "not provided" when there is no source at all', () => {
    const lines = attributionNoticeLines({
      source: '',
      sourceOther: '',
      referrer: '',
    })
    expect(lines).toContain('Source: not provided')
  })

  it('omits the referrer line when no referrer was given', () => {
    const lines = attributionNoticeLines({
      source: 'tiktok',
      sourceOther: '',
      referrer: '   ',
    })
    expect(lines).not.toContain('Referred by:')
  })

  it('treats null attribution as not provided (joined before we asked)', () => {
    const lines = attributionNoticeLines(null)
    expect(lines).toContain('Source: not provided')
  })
})

describe('attributionRowFromDraft', () => {
  it('keeps a picked source and trims free text', () => {
    expect(
      attributionRowFromDraft({
        source: 'instagram',
        sourceOther: '  ',
        referrer: '  Ronan  ',
      }),
    ).toEqual({ source: 'instagram', sourceOther: null, referrer: 'Ronan' })
  })

  it('keeps the Other free text when the user picked other', () => {
    expect(
      attributionRowFromDraft({
        source: 'other',
        sourceOther: 'a poster',
        referrer: '',
      }),
    ).toEqual({ source: 'other', sourceOther: 'a poster', referrer: null })
  })

  it('collapses an all-empty draft to all-null (a row that means "unknown")', () => {
    expect(
      attributionRowFromDraft({ source: '', sourceOther: '', referrer: '' }),
    ).toEqual({ source: null, sourceOther: null, referrer: null })
  })
})

describe('newUserNoticeText', () => {
  it('includes the email, total, and source line', () => {
    const text = newUserNoticeText('new@user.com', 12, {
      source: 'instagram',
      sourceOther: '',
      referrer: 'TJ',
    })
    expect(text).toContain('new@user.com just created a Souso account')
    expect(text).toContain('Total accounts: 12')
    expect(text).toContain('Source: Instagram')
    expect(text).toContain('Referred by: TJ')
  })

  it('falls back to not provided when no attribution is threaded', () => {
    const text = newUserNoticeText('new@user.com', 1, null)
    expect(text).toContain('Source: not provided')
  })
})
