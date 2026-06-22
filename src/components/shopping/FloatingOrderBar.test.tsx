import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { FloatingOrderBar } from './FloatingOrderBar'
import type { CartLinkResult } from '#/lib/cart-links-server'
import type { CompareLine } from '#/lib/shopping/cart-set'

/**
 * #440 — tapping "Order" used to block on the (slow, accurate-tier) cart-link
 * build BEFORE the tip screen appeared, so the user stared at a spinner. The fix
 * shows the tip sheet INSTANTLY and builds the link in the background; the build
 * is awaited only when the user confirms a tip. These tests lock that ordering:
 * they fail against the old "await buildCartLinks, then open the sheet" flow.
 */

const buildCartLinks = vi.fn()
const startTip = vi.fn()
const openStoreCart = vi.fn()

vi.mock('#/lib/cart-links-server', () => ({
  buildCartLinks: (...args: Array<unknown>) => buildCartLinks(...args),
}))
vi.mock('#/lib/tip-server', () => ({
  startTip: (...args: Array<unknown>) => startTip(...args),
}))
vi.mock('#/lib/open-store-cart', () => ({
  openStoreCart: (...args: Array<unknown>) => openStoreCart(...args),
  cartChunkOpenDelayMs: (n: number) => (n <= 1 ? 0 : (n - 1) * 1500 + 250),
}))
vi.mock('#/lib/analytics', () => ({
  track: vi.fn(),
  FUNNEL_EVENTS: {
    cartOpened: 'cart_opened',
    orderPlaced: 'order_placed',
    checkoutStarted: 'checkout_started',
  },
}))

const LINES: Array<CompareLine> = [
  { name: 'tomaten', amount: '500 g' },
] as Array<CompareLine>

function link(over: Partial<CartLinkResult> = {}): CartLinkResult {
  return {
    urls: ['https://ah.nl/cart?x=1'],
    matched: 3,
    total: 3,
    ...over,
  } as CartLinkResult
}

beforeEach(() => {
  buildCartLinks.mockReset()
  startTip
    .mockReset()
    .mockResolvedValue({ checkoutUrl: null, tipPaymentId: 't' })
  openStoreCart.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('FloatingOrderBar — instant tip screen (#440)', () => {
  it('shows the tip sheet before the cart-link build resolves', async () => {
    // A build that never resolves during this test: if the sheet still appears,
    // the open does NOT block on the build.
    let resolveBuild: (v: CartLinkResult) => void = () => {}
    buildCartLinks.mockReturnValue(
      new Promise<CartLinkResult>((res) => {
        resolveBuild = res
      }),
    )

    render(
      <FloatingOrderBar
        store="ah"
        data={null}
        compareLines={LINES}
        extras={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /order at/i }))

    // The tip sheet is open even though the build promise is still pending.
    expect(
      await screen.findByRole('dialog', { name: /send to your store/i }),
    ).toBeTruthy()
    expect(buildCartLinks).toHaveBeenCalledTimes(1)

    // Let the build settle so the test doesn't leak a pending promise.
    await act(async () => {
      resolveBuild(link())
    })
  })

  it('opens the cart on no-tip confirm using the background-built link', async () => {
    buildCartLinks.mockResolvedValue(link())

    render(
      <FloatingOrderBar
        store="ah"
        data={null}
        compareLines={LINES}
        extras={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /order at/i }))
    await screen.findByRole('dialog', { name: /send to your store/i })

    // Slide to no-tip (0) then confirm.
    const slider = screen.getByLabelText('Tip percentage')
    fireEvent.change(slider, { target: { value: '0' } })
    fireEvent.click(
      screen.getByRole('button', { name: /open my cart, no tip/i }),
    )

    await waitFor(() => expect(openStoreCart).toHaveBeenCalledTimes(1))
    expect(openStoreCart).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ['https://ah.nl/cart?x=1'] }),
    )
    // No-tip never creates a Mollie intent.
    expect(startTip).not.toHaveBeenCalled()
  })

  it('creates the Mollie intent only on a tip confirm, not on order tap', async () => {
    buildCartLinks.mockResolvedValue(link())

    render(
      <FloatingOrderBar
        store="ah"
        data={null}
        compareLines={LINES}
        extras={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /order at/i }))
    await screen.findByRole('dialog', { name: /send to your store/i })
    // Opening the order flow must NOT have started a payment.
    expect(startTip).not.toHaveBeenCalled()

    const slider = screen.getByLabelText('Tip percentage')
    fireEvent.change(slider, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /tip €/i }))

    await waitFor(() => expect(startTip).toHaveBeenCalledTimes(1))
    // The cart still opens on the tip path (popup-safe, before the redirect).
    expect(openStoreCart).toHaveBeenCalledTimes(1)
  })

  it('defers the Mollie redirect until every chunk tab has navigated', async () => {
    const multi = link({
      urls: [
        'https://www.ah.nl/mijnlijst/add-multiple?p=1:1',
        'https://www.ah.nl/mijnlijst/add-multiple?p=2:1',
        'https://www.ah.nl/mijnlijst/add-multiple?p=3:1',
      ],
    })
    buildCartLinks.mockResolvedValue(multi)
    startTip.mockResolvedValue({
      checkoutUrl: 'https://mollie.test/checkout',
      tipPaymentId: 't',
    })

    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    render(
      <FloatingOrderBar
        store="ah"
        data={null}
        compareLines={LINES}
        extras={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /order at/i }))
    await screen.findByRole('dialog', { name: /send to your store/i })

    const slider = screen.getByLabelText('Tip percentage')
    fireEvent.change(slider, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /tip €/i }))

    await waitFor(() => expect(startTip).toHaveBeenCalledTimes(1))
    expect(openStoreCart).toHaveBeenCalledTimes(1)
    // 3 chunks → (3 - 1) * 1500 + 250 = 3250ms before Mollie redirect.
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3250)

    setTimeoutSpy.mockRestore()
  })

  it('redirects to Mollie immediately for a single-chunk cart', async () => {
    buildCartLinks.mockResolvedValue(link())
    startTip.mockResolvedValue({
      checkoutUrl: 'https://mollie.test/checkout',
      tipPaymentId: 't',
    })

    let href = ''
    vi.stubGlobal('location', {
      get href() {
        return href
      },
      set href(v: string) {
        href = v
      },
    })
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout')

    render(
      <FloatingOrderBar
        store="ah"
        data={null}
        compareLines={LINES}
        extras={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /order at/i }))
    await screen.findByRole('dialog', { name: /send to your store/i })

    const slider = screen.getByLabelText('Tip percentage')
    fireEvent.change(slider, { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /tip €/i }))

    await waitFor(() => expect(href).toBe('https://mollie.test/checkout'))
    // Single chunk: assign location directly, no deferred redirect.
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 3250)

    setTimeoutSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})
