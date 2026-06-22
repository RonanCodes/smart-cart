import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BetaBadge } from './beta-badge'
import { BETA_LABEL, BETA_NOTE } from '#/lib/beta'

describe('BetaBadge', () => {
  it('renders the Beta label', () => {
    render(<BetaBadge />)
    expect(screen.getByText(/beta/i)).toBeTruthy()
  })

  it('passes through an extra className', () => {
    const { container } = render(<BetaBadge className="ml-2" />)
    expect((container.firstChild as HTMLElement).className).toContain('ml-2')
  })

  it('is a subtle muted pill, not a loud solid fill (#407)', () => {
    const { container } = render(<BetaBadge />)
    const cls = (container.firstChild as HTMLElement).className
    // Soft mustard tint + hairline border + low-contrast text = quiet, not
    // in-your-face. It must NOT be the old solid `bg-accent` fill.
    expect(cls).toContain('bg-accent/10')
    expect(cls).toContain('border-accent/40')
    expect(cls).toContain('text-foreground/60')
    // Not the old solid fill: `bg-accent` with no opacity modifier.
    expect(cls).not.toMatch(/bg-accent(?![/-])/)
    expect(cls).not.toContain('text-accent-foreground')
  })
})

describe('beta copy', () => {
  it('label is "Beta"', () => {
    expect(BETA_LABEL).toBe('Beta')
  })

  it('first-run note sets the beta + early-tester + feedback expectation', () => {
    expect(BETA_NOTE.toLowerCase()).toContain('beta')
    expect(BETA_NOTE.toLowerCase()).toContain('tester')
    // invites feedback so "expect issues" comes with "tell us"
    expect(BETA_NOTE.toLowerCase()).toMatch(/tell us|what breaks|feedback/)
  })

  it('note avoids em/en dashes (house copy rule)', () => {
    expect(BETA_NOTE).not.toMatch(/[–—]/)
  })
})
