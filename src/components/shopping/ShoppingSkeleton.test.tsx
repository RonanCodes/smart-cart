import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ShoppingSkeleton } from './ShoppingSkeleton'

/**
 * The restructured /shopping pendingComponent (#226 follow-up): render the real
 * page CHROME immediately (title, store switch, the "Order at <store>" bar) in a
 * disabled/loading state, and shimmer ONLY the data item rows, so the layout is
 * stable and only the data area animates in. These lock that the chrome is
 * present (not a full-screen wash) and the rows are the loading region.
 *
 * AppShell pulls in the TabBar (router hooks) + InstallPrompt; stub it to a plain
 * passthrough so this stays a pure UI assertion on the skeleton's own chrome.
 */
vi.mock('#/components/ui/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

afterEach(cleanup)

describe('ShoppingSkeleton chrome-first loading state', () => {
  it('renders the real Cart title immediately (not a placeholder)', () => {
    render(<ShoppingSkeleton />)
    expect(screen.getByRole('heading', { name: 'Cart' })).toBeTruthy()
  })

  it('renders the store switch chrome while loading', () => {
    render(<ShoppingSkeleton />)
    expect(
      screen.getByRole('radiogroup', { name: /compare stores/i }),
    ).toBeTruthy()
  })

  it('renders the disabled "Order at <store>" bar chrome', () => {
    render(<ShoppingSkeleton />)
    // The order button is present (so the layout is stable) but disabled.
    const order = screen.getByText(/order at/i).closest('button')
    expect(order).toBeTruthy()
    expect(order?.disabled).toBe(true)
  })

  it('shimmers ONLY the item-rows data area (the loading region)', () => {
    const { container } = render(<ShoppingSkeleton />)
    const busy = container.querySelector('[aria-busy="true"]')
    expect(busy).toBeTruthy()
    expect(busy?.getAttribute('aria-label')).toMatch(/shopping list/i)
  })
})
