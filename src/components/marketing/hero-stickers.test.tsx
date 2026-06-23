import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react'
import { HeroStickers } from './hero-stickers'

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

  it('keeps the left/middle/right slot layout intact', () => {
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

  it('does NOT auto-cycle dishes over time (stickers are static)', () => {
    vi.useFakeTimers()
    render(<HeroStickers />)
    const board = screen.getByTestId('hero-stickers')

    const before = Array.from(board.querySelectorAll('img.hero-sticker')).map(
      (img) => (img as HTMLImageElement).getAttribute('src'),
    )

    // Let any would-be timer fire many times over: nothing should change.
    act(() => {
      vi.advanceTimersByTime(60000)
    })

    const after = Array.from(board.querySelectorAll('img.hero-sticker')).map(
      (img) => (img as HTMLImageElement).getAttribute('src'),
    )

    expect(after).toEqual(before)
  })

  it('exposes each sticker as a tappable button', () => {
    render(<HeroStickers />)
    const buttons = screen
      .getByTestId('hero-stickers')
      .querySelectorAll('button[data-slot]')
    expect(buttons).toHaveLength(3)
  })

  it('advances a sticker to the next dish in its pool on tap', () => {
    render(<HeroStickers />)
    const board = screen.getByTestId('hero-stickers')
    const leftSlot = board.querySelector(
      'button[data-slot="left"]',
    ) as HTMLButtonElement
    const img = leftSlot.querySelector('img.hero-sticker') as HTMLImageElement

    const before = img.getAttribute('src')
    fireEvent.click(leftSlot)
    const after = (
      leftSlot.querySelector('img.hero-sticker') as HTMLImageElement
    ).getAttribute('src')

    expect(after).not.toEqual(before)
  })

  it('cycles back to the first dish after tapping through the whole pool', () => {
    render(<HeroStickers />)
    const board = screen.getByTestId('hero-stickers')
    const leftSlot = board.querySelector(
      'button[data-slot="left"]',
    ) as HTMLButtonElement
    const srcOf = () =>
      (
        leftSlot.querySelector('img.hero-sticker') as HTMLImageElement
      ).getAttribute('src')

    const first = srcOf()
    const seen = new Set<string>([first as string])
    // Tap until we have seen at least two distinct dishes, then wrap home.
    fireEvent.click(leftSlot)
    seen.add(srcOf() as string)
    fireEvent.click(leftSlot)
    seen.add(srcOf() as string)
    fireEvent.click(leftSlot)
    // Pool has three dishes, so three taps wraps back to the first.
    expect(srcOf()).toEqual(first)
    expect(seen.size).toBe(3)
  })
})
