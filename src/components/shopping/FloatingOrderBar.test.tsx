import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { FloatingOrderBar } from './FloatingOrderBar'
import type { CartLinkResult } from '#/lib/cart-links-server'
import type { CompareLine } from '#/lib/shopping/cart-set'

/**
 * #440 — tip sheet opens instantly; cart build runs in background.
 * Pay-first — tip > 0 stashes the link and redirects to Mollie; cart opens on
 * /tip/{id}/return. Tip = 0 opens the cart immediately with no Mollie call.
 */

const buildCartLinks = vi.fn()
const startTip = vi.fn()
const openStoreCart = vi.fn()
const stashPendingCart = vi.fn()
const track = vi.fn()

vi.mock('#/lib/cart-links-server', () => ({
  buildCartLinks: (...args: Array<unknown>) => buildCartLinks(...args),
}))
vi.mock('#/lib/tip-server', () => ({
  startTip: (...args: Array<unknown>) => startTip(...args),
}))
vi.mock('#/lib/open-store-cart', () => ({
  openStoreCart: (...args: Array<unknown>) => openStoreCart(...args),
}))
vi.mock('#/lib/pending-cart', () => ({
  stashPendingCart: (...args: Array<unknown>) => stashPendingCart(...args),
}))
// Mirror the real catalog so the test asserts against the same snake_case names.
vi.mock('#/lib/analytics', () => ({
  track: (...args: Array<unknown>) => track(...args),
  FUNNEL_EVENTS: {
    orderClicked: 'order_clicked',
    tipDialogOpened: 'tip_dialog_opened',
    tipSelected: 'tip_selected',
    ahCartOpened: 'ah_cart_opened',
  },
}))

const LINES: Array<CompareLine> = [
  { name: 'tomaten', amount: '500 g' },
] as Array<CompareLine>

function link(over: Partial<CartLinkResult> = {}): CartLinkResult {
  return {
    store: 'ah',
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
  stashPendingCart.mockReset()
  track.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FloatingOrderBar approximate-price disclaimer', () => {
  it('shows the "prices are approximate" note near the total', () => {
    render(
      <FloatingOrderBar
        store="ah"
        data={null}
        compareLines={LINES}
        extras={[]}
      />,
    )
    expect(
      screen.getByText(/prices are approximate and may differ at checkout/i),
    ).toBeTruthy()
  })

  it('shows partial match in the headline when pricing knows not every line matched', () => {
    render(
      <FloatingOrderBar
        store="ah"
        data={{
          baskets: [
            {
              store: 'ah',
              displayName: 'Albert Heijn',
              lineItems: [
                {
                  ingredient: 'tomaten',
                  productName: 'Tomaat',
                  packSize: '500 g',
                  packPriceCents: 199,
                  packs: 1,
                  lineCents: 199,
                  slug: 'wi1',
                  confidence: 'high',
                  estimated: false,
                  waste: null,
                },
              ],
              totalCents: 199,
              totalWaste: {
                cents: 0,
                massGrams: 0,
                volumeMl: 0,
                count: 0,
                unknownLines: 0,
                hasUnknown: false,
              },
              unavailable: [{ ingredient: 'missing' }],
              estimatedCount: 0,
            },
          ],
          cheapest: null,
        }}
        compareLines={[
          { name: 'tomaten', amount: '500 g' },
          { name: 'missing', amount: '1' },
        ]}
        extras={[]}
      />,
    )
    expect(
      screen.getByText('1 of 2 items matched at Albert Heijn'),
    ).toBeTruthy()
    expect(screen.queryByText(/items matched a Albert/i)).toBeNull()
  })
})

describe('FloatingOrderBar — instant tip screen (#440)', () => {
  it('shows the tip sheet before the cart-link build resolves', async () => {
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

    expect(
      await screen.findByRole('dialog', { name: /send to your store/i }),
    ).toBeTruthy()
    expect(buildCartLinks).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveBuild(link())
    })
  })

  it('opens the cart on no-tip confirm without calling startTip', async () => {
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

    const slider = screen.getByLabelText('Tip percentage')
    fireEvent.change(slider, { target: { value: '0' } })
    fireEvent.click(
      screen.getByRole('button', { name: /open my cart, no tip/i }),
    )

    await waitFor(() => expect(openStoreCart).toHaveBeenCalledTimes(1))
    expect(openStoreCart).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ['https://ah.nl/cart?x=1'] }),
    )
    expect(startTip).not.toHaveBeenCalled()
    expect(stashPendingCart).not.toHaveBeenCalled()
  })

  it('pay-first: tip confirm stashes the cart and redirects to Mollie without opening it', async () => {
    const built = link()
    buildCartLinks.mockResolvedValue(built)
    startTip.mockResolvedValue({
      checkoutUrl: 'https://mollie.test/checkout',
      tipPaymentId: 'tip-pay-1',
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
    expect(openStoreCart).not.toHaveBeenCalled()
    expect(stashPendingCart).toHaveBeenCalledWith('tip-pay-1', built)
    expect(href).toBe('https://mollie.test/checkout')
  })
})

describe('FloatingOrderBar — funnel instrumentation', () => {
  /** Pull every (event, props) pair the component fired this test. */
  function trackedEvents() {
    return track.mock.calls.map((c) => c[0] as string)
  }

  it('fires order_clicked + tip_dialog_opened when "Order" is tapped', async () => {
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
    await screen.findByRole('dialog', { name: /send to your store/i })

    expect(track).toHaveBeenCalledWith(
      'order_clicked',
      expect.objectContaining({ store: 'ah' }),
    )
    expect(track).toHaveBeenCalledWith(
      'tip_dialog_opened',
      expect.objectContaining({ store: 'ah' }),
    )

    await act(async () => {
      resolveBuild(link())
    })
  })

  it('fires tip_selected (tipped=false, amount=0) + ah_cart_opened on no-tip confirm', async () => {
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

    const slider = screen.getByLabelText('Tip percentage')
    fireEvent.change(slider, { target: { value: '0' } })
    fireEvent.click(
      screen.getByRole('button', { name: /open my cart, no tip/i }),
    )

    await waitFor(() => expect(openStoreCart).toHaveBeenCalledTimes(1))
    expect(track).toHaveBeenCalledWith(
      'tip_selected',
      expect.objectContaining({ store: 'ah', amount: 0, tipped: false }),
    )
    expect(track).toHaveBeenCalledWith(
      'ah_cart_opened',
      expect.objectContaining({ store: 'ah', matched: 3 }),
    )
  })

  it('fires tip_selected (tipped=true) on a paid tip confirm', async () => {
    buildCartLinks.mockResolvedValue(link())
    startTip.mockResolvedValue({
      checkoutUrl: 'https://mollie.test/checkout',
      tipPaymentId: 'tip-pay-1',
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
    expect(track).toHaveBeenCalledWith(
      'tip_selected',
      expect.objectContaining({ store: 'ah', tipped: true }),
    )
    // A paid tip redirects to Mollie; the cart opens on the return route, so no
    // ah_cart_opened fires here.
    expect(trackedEvents()).not.toContain('ah_cart_opened')
  })

  it('fires nothing when the selected store cannot order yet (picnic)', () => {
    render(
      <FloatingOrderBar
        store="picnic"
        data={null}
        compareLines={LINES}
        extras={[]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /order at/i }))
    expect(track).not.toHaveBeenCalled()
    expect(buildCartLinks).not.toHaveBeenCalled()
  })
})
