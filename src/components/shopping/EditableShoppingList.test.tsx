import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditableShoppingList } from './EditableShoppingList'
import type { ShoppingItem } from '#/lib/shopping'

/**
 * The list-edit funnel (`cart_updated`, sliced by `action`) plus `added_to_cart`
 * for a manual add. Each handler captures the event at the UI call-site; the
 * server round-trips are mocked so the test asserts only the analytics surface.
 */

const updateShoppingItem = vi.fn()
const addShoppingItem = vi.fn()
const removeShoppingItem = vi.fn()
const setAllChecked = vi.fn()
const clearShoppingList = vi.fn()

vi.mock('#/lib/shopping-list-server', () => ({
  updateShoppingItem: (...a: Array<unknown>) => updateShoppingItem(...a),
  addShoppingItem: (...a: Array<unknown>) => addShoppingItem(...a),
  removeShoppingItem: (...a: Array<unknown>) => removeShoppingItem(...a),
  setAllChecked: (...a: Array<unknown>) => setAllChecked(...a),
  clearShoppingList: (...a: Array<unknown>) => clearShoppingList(...a),
}))

const track = vi.fn()
vi.mock('#/lib/analytics', () => ({
  track: (...a: Array<unknown>) => track(...a),
  FUNNEL_EVENTS: { cartUpdated: 'cart_updated', addedToCart: 'added_to_cart' },
}))

function item(over: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    id: 'i1',
    name: 'tomaten',
    amount: '500 g',
    checked: true,
    ...over,
  } as ShoppingItem
}

beforeEach(() => {
  track.mockReset()
  updateShoppingItem.mockReset().mockResolvedValue({ items: [item()] })
  addShoppingItem
    .mockReset()
    .mockResolvedValue({ items: [item(), item({ id: 'i2', name: 'ui' })] })
  removeShoppingItem.mockReset().mockResolvedValue({ items: [] })
  setAllChecked.mockReset().mockResolvedValue({ items: [item()] })
  clearShoppingList.mockReset().mockResolvedValue({ items: [] })
})

describe('EditableShoppingList — cart_updated funnel', () => {
  it('fires cart_updated{action:deselect} when a checked row is toggled off', () => {
    render(<EditableShoppingList initialItems={[item({ checked: true })]} />)
    fireEvent.click(
      screen.getByRole('checkbox', { name: /remove tomaten from your order/i }),
    )
    expect(track).toHaveBeenCalledWith(
      'cart_updated',
      expect.objectContaining({ action: 'deselect' }),
    )
  })

  it('fires cart_updated{action:select} when an unchecked row is toggled on', () => {
    render(<EditableShoppingList initialItems={[item({ checked: false })]} />)
    fireEvent.click(
      screen.getByRole('checkbox', { name: /add tomaten to your order/i }),
    )
    expect(track).toHaveBeenCalledWith(
      'cart_updated',
      expect.objectContaining({ action: 'select' }),
    )
  })

  it('fires cart_updated{action:remove} when a row is removed', () => {
    render(<EditableShoppingList initialItems={[item()]} />)
    fireEvent.click(screen.getByRole('button', { name: /^remove tomaten$/i }))
    expect(track).toHaveBeenCalledWith(
      'cart_updated',
      expect.objectContaining({ action: 'remove' }),
    )
  })

  it('fires cart_updated{action:select_all} from the header control', () => {
    render(<EditableShoppingList initialItems={[item({ checked: false })]} />)
    fireEvent.click(screen.getByRole('button', { name: /select all/i }))
    expect(track).toHaveBeenCalledWith(
      'cart_updated',
      expect.objectContaining({ action: 'select_all', checked: true }),
    )
  })

  it('fires cart_updated{action:clear_all} only on the confirming second tap', () => {
    render(<EditableShoppingList initialItems={[item()]} />)
    const clear = screen.getByRole('button', { name: /clear all items/i })
    fireEvent.click(clear) // arm
    const sawClearAll = () =>
      track.mock.calls.some(
        (c) =>
          (c[1] as { action?: string } | undefined)?.action === 'clear_all',
      )
    expect(sawClearAll()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /confirm clear all/i }))
    expect(track).toHaveBeenCalledWith(
      'cart_updated',
      expect.objectContaining({ action: 'clear_all' }),
    )
  })

  it('fires cart_updated{action:edit_qty} when an amount is edited inline', () => {
    render(<EditableShoppingList initialItems={[item()]} />)
    fireEvent.click(
      screen.getByRole('button', { name: /edit amount of tomaten/i }),
    )
    const input = screen.getByLabelText(/edit amount of tomaten/i)
    fireEvent.change(input, { target: { value: '600 g' } })
    fireEvent.blur(input)
    expect(track).toHaveBeenCalledWith(
      'cart_updated',
      expect.objectContaining({ action: 'edit_qty', field: 'amount' }),
    )
  })

  it('fires added_to_cart when a manual item is added', async () => {
    render(<EditableShoppingList initialItems={[item()]} />)
    fireEvent.click(screen.getByRole('button', { name: /add an item/i }))
    const name = screen.getByLabelText(/new item name/i)
    fireEvent.change(name, { target: { value: 'ui' } })
    fireEvent.click(screen.getByRole('button', { name: /^add item$/i }))
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith(
        'added_to_cart',
        expect.objectContaining({ source: 'manual_item' }),
      ),
    )
  })
})
