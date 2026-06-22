import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { HeroStickers } from './hero-stickers'

/**
 * jsdom has no matchMedia; install a controllable stub so we can flip
 * prefers-reduced-motion per test. `reduced` toggles what `.matches` returns.
 */
function installMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('HeroStickers', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders exactly three dish stickers across three slots', () => {
    installMatchMedia(false)
    render(<HeroStickers />)
    const board = screen.getByTestId('hero-stickers')
    const slots = board.querySelectorAll('[data-slot]')
    expect(slots).toHaveLength(3)
    expect(board.querySelectorAll('img.hero-sticker')).toHaveLength(3)
    // The hand-written note is still pinned in the corner.
    expect(screen.getByText(/what.+for dinner/i)).toBeTruthy()
  })

  it('left/middle/right slots are present so drift can go up/down/sway', () => {
    installMatchMedia(false)
    render(<HeroStickers />)
    const board = screen.getByTestId('hero-stickers')
    expect(board.querySelector('[data-slot="left"]')).toBeTruthy()
    expect(board.querySelector('[data-slot="middle"]')).toBeTruthy()
    expect(board.querySelector('[data-slot="right"]')).toBeTruthy()
  })

  it('keeps the souso-sticker die-cut treatment on every dish', () => {
    installMatchMedia(false)
    render(<HeroStickers />)
    const imgs = screen
      .getByTestId('hero-stickers')
      .querySelectorAll('img.hero-sticker')
    imgs.forEach((img) => expect(img.className).toContain('souso-sticker'))
  })

  describe('with motion allowed', () => {
    beforeEach(() => {
      installMatchMedia(false)
      vi.useFakeTimers()
    })

    it('cycles a slot to a fresh dish over time (pop in / fade out loop)', () => {
      render(<HeroStickers />)
      const board = screen.getByTestId('hero-stickers')
      expect(board.getAttribute('data-reduced')).toBe('false')
      const before = Array.from(board.querySelectorAll('img.hero-sticker')).map(
        (img) => (img as HTMLImageElement).getAttribute('src'),
      )

      // Advance well past all three staggered cycle intervals.
      act(() => {
        vi.advanceTimersByTime(12000)
      })

      const after = Array.from(board.querySelectorAll('img.hero-sticker')).map(
        (img) => (img as HTMLImageElement).getAttribute('src'),
      )

      // At least one slot now shows a different dish.
      expect(after).not.toEqual(before)
    })
  })

  describe('prefers-reduced-motion', () => {
    beforeEach(() => {
      installMatchMedia(true)
      vi.useFakeTimers()
    })

    it('marks itself reduced and never cycles dishes', () => {
      render(<HeroStickers />)
      const board = screen.getByTestId('hero-stickers')
      expect(board.getAttribute('data-reduced')).toBe('true')

      const before = Array.from(board.querySelectorAll('img.hero-sticker')).map(
        (img) => (img as HTMLImageElement).getAttribute('src'),
      )

      act(() => {
        vi.advanceTimersByTime(20000)
      })

      const after = Array.from(board.querySelectorAll('img.hero-sticker')).map(
        (img) => (img as HTMLImageElement).getAttribute('src'),
      )

      // Static: the dishes are unchanged after the would-be cycle window.
      expect(after).toEqual(before)
    })
  })
})
