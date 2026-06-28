import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CartPriceSlot } from './CartPriceSlot'

describe('CartPriceSlot', () => {
  it('shows a visible pending affordance while a price is loading', () => {
    render(<CartPriceSlot pending reserve size="row" />)
    expect(screen.getByLabelText('Pricing')).toBeTruthy()
    expect(screen.getByText('···')).toBeTruthy()
  })

  it('shows the settled price and an updating affordance for partial totals', () => {
    render(<CartPriceSlot priceCents={1299} updating reserve size="bar" />)
    expect(screen.getByText('€12.99')).toBeTruthy()
    expect(screen.getByLabelText('Updating price')).toBeTruthy()
  })
})
