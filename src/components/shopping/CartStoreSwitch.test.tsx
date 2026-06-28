import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'
import { CartStoreSwitch } from './CartStoreSwitch'
import { FlagsProvider } from '#/lib/flags-context'
import { mergeFlags } from '#/lib/flags'
import type { FlagSet } from '#/lib/flags'

const track = vi.fn()
vi.mock('#/lib/analytics', () => ({
  track: (...args: Array<unknown>) => track(...args),
  FUNNEL_EVENTS: { storeSelected: 'store_selected' },
}))

beforeEach(() => {
  track.mockReset()
})

/** Render the switch inside a FlagsProvider (defaults: Jumbo hidden). */
function renderSwitch(ui: ReactElement, flags: FlagSet = mergeFlags(null)) {
  return render(<FlagsProvider flags={flags}>{ui}</FlagsProvider>)
}

/** Flags with Jumbo turned on (visible), for the "enabled" path. */
const JUMBO_ON = mergeFlags({ 'store.jumbo.visible': true })

describe('CartStoreSwitch — store_selected funnel event', () => {
  it('fires store_selected (source cart) and onSelect when a store is tapped', () => {
    const onSelect = vi.fn()
    renderSwitch(
      <CartStoreSwitch
        data={null}
        loading={false}
        selected="ah"
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: /Picnic/ }))

    expect(onSelect).toHaveBeenCalledWith('picnic')
    expect(track).toHaveBeenCalledWith('store_selected', {
      store: 'picnic',
      source: 'cart',
    })
  })

  it('fires nothing when a hidden store (Jumbo, flag off) is tapped', () => {
    const onSelect = vi.fn()
    renderSwitch(
      <CartStoreSwitch
        data={null}
        loading={false}
        selected="ah"
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: /Jumbo/ }))

    expect(onSelect).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
  })

  it('fires store_selected + onSelect when Jumbo is tapped once its flag is on', () => {
    const onSelect = vi.fn()
    renderSwitch(
      <CartStoreSwitch
        data={null}
        loading={false}
        selected="ah"
        onSelect={onSelect}
      />,
      JUMBO_ON,
    )

    fireEvent.click(screen.getByRole('radio', { name: /Jumbo/ }))

    expect(onSelect).toHaveBeenCalledWith('jumbo')
    expect(track).toHaveBeenCalledWith('store_selected', {
      store: 'jumbo',
      source: 'cart',
    })
  })
})

describe('CartStoreSwitch — pricing progress', () => {
  it('shows a per-store priced/total count while pricing is in flight', () => {
    const pending = new Set(
      Array.from({ length: 37 }, (_, i) => `line-${i}|500 g`),
    )
    render(
      <CartStoreSwitch
        data={null}
        loading
        lineTotal={45}
        storePendingLineKeys={{ ah: pending, jumbo: pending, picnic: pending }}
        selected="ah"
        onSelect={() => {}}
      />,
    )

    expect(
      screen.getAllByLabelText('Pricing 8 of 45 items').length,
    ).toBeGreaterThanOrEqual(1)
    const ah = screen.getByRole('radio', { name: /Albert Heijn/ })
    expect(ah.textContent).toContain('8/45')
  })

  it('keeps the partial total visible beside the priced/total count', () => {
    render(
      <CartStoreSwitch
        data={{
          baskets: [
            {
              store: 'ah',
              displayName: 'ah',
              lineItems: [
                {
                  ingredient: 'tomaten',
                  productName: 'Tomaten',
                  packSize: '500 g',
                  packPriceCents: 199,
                  packs: 1,
                  lineCents: 199,
                  slug: 'wi1/tomaten',
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
              unavailable: [],
              estimatedCount: 0,
            },
          ],
          cheapest: null,
        }}
        loading
        lineTotal={10}
        storePendingLineKeys={{ ah: new Set(['a|', 'b|', 'c|']) }}
        selected="ah"
        onSelect={() => {}}
      />,
    )

    expect(screen.getByText('€1.99')).toBeTruthy()
    expect(screen.getByLabelText('Pricing 7 of 10 items')).toBeTruthy()
  })
})
