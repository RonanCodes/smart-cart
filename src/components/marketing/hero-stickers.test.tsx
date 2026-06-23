import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { HeroStickers } from './hero-stickers'

function srcsOf(board: HTMLElement): Array<string | null> {
  return Array.from(board.querySelectorAll('img.hero-sticker')).map((img) =>
    (img as HTMLImageElement).getAttribute('src'),
  )
}

describe('HeroStickers', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders exactly three dish stickers across three slots', () => {
    render(<HeroStickers />)
    const board = screen.getByTestId('hero-stickers')
    const slots = board.querySelectorAll('[data-slot]')
    expect(slots).toHaveLength(3)
    expect(board.querySelectorAll('img.hero-sticker')).toHaveLength(3)
    // The hand-written note is still pinned in the corner.
    expect(screen.getByText(/what.+for dinner/i)).toBeTruthy()
  })

  it('keeps the left/middle/right 3-slot layout', () => {
    render(<HeroStickers />)
    const board = screen.getByTestId('hero-stickers')
    expect(board.querySelector('[data-slot="left"]')).toBeTruthy()
    expect(board.querySelector('[data-slot="middle"]')).toBeTruthy()
    expect(board.querySelector('[data-slot="right"]')).toBeTruthy()
  })

  it('keeps the souso-sticker die-cut treatment on every dish', () => {
    render(<HeroStickers />)
    const imgs = screen
      .getByTestId('hero-stickers')
      .querySelectorAll('img.hero-sticker')
    imgs.forEach((img) => expect(img.className).toContain('souso-sticker'))
  })

  it('renders the SAME curated set on every mount (deterministic, not random)', () => {
    const { unmount } = render(<HeroStickers />)
    const first = srcsOf(screen.getByTestId('hero-stickers'))
    unmount()
    cleanup()

    render(<HeroStickers />)
    const second = srcsOf(screen.getByTestId('hero-stickers'))

    // Deterministic: a fresh mount shows the exact same three dishes.
    expect(second).toEqual(first)
    // And it is a real, fully-populated set (no empty src).
    expect(first.every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
  })

  it('never auto-cycles a slot over time (no timers, fully static by default)', () => {
    vi.useFakeTimers()
    render(<HeroStickers />)
    const board = screen.getByTestId('hero-stickers')
    const before = srcsOf(board)

    // Let any would-be cycle interval fire many times over.
    act(() => {
      vi.advanceTimersByTime(60000)
    })

    const after = srcsOf(board)
    expect(after).toEqual(before)
  })

  it('advances a slot to the next dish when tapped, leaving the others put', () => {
    render(<HeroStickers />)
    const board = screen.getByTestId('hero-stickers')
    const before = srcsOf(board)

    const leftButton = board.querySelector(
      'button[data-slot="left"]',
    ) as HTMLButtonElement
    expect(leftButton).toBeTruthy()

    act(() => {
      fireEvent.click(leftButton)
    })

    const after = srcsOf(board)
    // The tapped slot shows a different dish...
    expect(after[0]).not.toBe(before[0])
    // ...and the untouched slots are unchanged.
    expect(after[1]).toBe(before[1])
    expect(after[2]).toBe(before[2])
  })

  it('exposes each sticker slot as an accessible button', () => {
    render(<HeroStickers />)
    const board = screen.getByTestId('hero-stickers')
    const buttons = board.querySelectorAll('button')
    // One tappable button per slot (the StickyNote is not a button).
    expect(buttons.length).toBeGreaterThanOrEqual(3)
    buttons.forEach((b) => {
      expect(b.getAttribute('type')).toBe('button')
      expect((b.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0)
    })
  })
})
