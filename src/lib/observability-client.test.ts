import { describe, it, expect } from 'vitest'
import { loaderDataShape, sousoFeedbackOptions } from './observability-client'

/**
 * The undefined-route/loader-data bugs on /week were the worst post-launch issues
 * — a Sentry error had no clue what the loader returned. `loaderDataShape`
 * captures the SHAPE (keys + types, never values) so a Sentry error shows what the
 * loader actually handed the route, without leaking recipe data or PII.
 *
 * Pure + exported so it is unit-testable without booting Sentry (the rest of the
 * module is guarded no-ops until `initObservability` runs in the browser).
 */
describe('loaderDataShape', () => {
  it('reports null / undefined plainly (the exact /week crash signal)', () => {
    expect(loaderDataShape(null)).toEqual({ type: 'null' })
    expect(loaderDataShape(undefined)).toEqual({ type: 'undefined' })
  })

  it('reports the keys and value-types of an object, not the values', () => {
    const shape = loaderDataShape({
      kind: 'week',
      offset: 0,
      week: { planId: 'p1' },
      feedback: [],
    })
    expect(shape).toEqual({
      type: 'object',
      keys: ['kind', 'offset', 'week', 'feedback'],
      types: {
        kind: 'string',
        offset: 'number',
        week: 'object',
        feedback: 'array',
      },
    })
  })

  it('does not leak primitive values, only the type', () => {
    const shape = loaderDataShape('a-recipe-secret') as { type: string }
    expect(shape.type).toBe('string')
    expect(JSON.stringify(shape)).not.toContain('secret')
  })

  it('marks arrays distinctly from objects', () => {
    expect(loaderDataShape([1, 2, 3])).toEqual({ type: 'array', length: 3 })
  })

  it('never throws on awkward input', () => {
    expect(() => loaderDataShape(NaN)).not.toThrow()
    expect(() => loaderDataShape(() => {})).not.toThrow()
  })
})

/**
 * The Sentry user-feedback widget (#404) is the single always-available feedback
 * button. Its branding/copy is config, so we lock the load-bearing bits: Souso
 * brand colours (not Sentry defaults), plain-voice labels, no Sentry branding,
 * and the house copy rule (no em/en dashes). The wiring into `Sentry.init` is
 * prod-gated, so a pure-config test is the right level here.
 */
describe('sousoFeedbackOptions', () => {
  const opts = sousoFeedbackOptions()

  it('uses the Souso brand palette (mustard accent, forest/cream)', () => {
    expect(opts.themeLight.accentBackground).toBe('#e8a33d')
    expect(opts.themeLight.background).toBe('#f6f2e8')
    expect(opts.themeLight.foreground).toBe('#16341f')
  })

  it('hides Sentry branding so it reads as a Souso touch', () => {
    expect(opts.showBranding).toBe(false)
  })

  it('labels the trigger "Feedback" in plain voice', () => {
    expect(opts.triggerLabel).toBe('Feedback')
    expect(opts.submitButtonLabel.toLowerCase()).toContain('feedback')
  })

  it('keeps the form short: no required name/email gate for a beta note', () => {
    expect(opts.isNameRequired).toBe(false)
    expect(opts.isEmailRequired).toBe(false)
  })

  it('copy avoids em/en dashes (house copy rule)', () => {
    const copy = [
      opts.triggerLabel,
      opts.formTitle,
      opts.messageLabel,
      opts.messagePlaceholder,
      opts.submitButtonLabel,
      opts.cancelButtonLabel,
      opts.successMessageText,
    ].join(' ')
    expect(copy).not.toMatch(/[–—]/)
  })
})
