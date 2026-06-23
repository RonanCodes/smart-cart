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
const track = vi.fn()
vi.mock('#/lib/analytics', () => ({
  track: (...args: Array<unknown>) => track(...args),
  FUNNEL_EVENTS: {
    cartOpened: 'cart_opened',
    orderClicked: 'order_clicked',
    orderPlaced: 'order_placed',
    ahCartOpened: 'ah_cart_opened',
    tipDialogOpened: 'tip_dialog_opened',
    tipSelected: 'tip_selected',
    checkoutStarted: 'checkout_started',
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

describe('FloatingOrderBar — funnel analytics', () => {
  it('fires order_clicked + tip_dialog_opened when "Order at <store>" is tapped', async () => {
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

    expect(track).toHaveBeenCalledWith(
      'order_clicked',
      expect.objectContaining({ store: 'ah' }),
    )
    expect(track).toHaveBeenCalledWith(
      'tip_dialog_opened',
      expect.objectContaining({ store: 'ah' }),
    )
  })

  it('fires tip_selected (tipped:false) and ah_cart_opened on a no-tip confirm', async () => {
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
      expect.objectContaining({ store: 'ah', tipped: false, amount: 0 }),
    )
    expect(track).toHaveBeenCalledWith(
      'ah_cart_opened',
      expect.objectContaining({ store: 'ah' }),
    )
  })

  it('fires tip_selected (tipped:true) with a numeric amount on a tipped confirm', async () => {
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
    const tipCall = track.mock.calls.find((c) => c[0] === 'tip_selected')
    expect(tipCall).toBeTruthy()
    const props = tipCall?.[1] as { tipped: boolean; amount: number }
    expect(props.tipped).toBe(true)
    expect(typeof props.amount).toBe('number')
    expect(props.amount).toBeGreaterThan(0)
  })
})
