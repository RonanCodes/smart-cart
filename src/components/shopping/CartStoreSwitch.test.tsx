import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CartStoreSwitch } from './CartStoreSwitch'

const track = vi.fn()
vi.mock('#/lib/analytics', () => ({
  track: (...args: Array<unknown>) => track(...args),
  FUNNEL_EVENTS: { storeSelected: 'store_selected' },
}))

beforeEach(() => {
  track.mockReset()
})

describe('CartStoreSwitch — store_selected funnel event', () => {
  it('fires store_selected (source cart) and onSelect when a store is tapped', () => {
    const onSelect = vi.fn()
    render(
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

  it('fires nothing when the disabled "Coming soon" store is tapped', () => {
    const onSelect = vi.fn()
    render(
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
})
