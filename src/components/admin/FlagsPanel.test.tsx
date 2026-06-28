import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FlagsPanel } from './FlagsPanel'
import { mergeFlags } from '#/lib/flags'

/**
 * The admin Feature-flags panel. The write goes through the admin-gated setFlags
 * server fn (mocked here); the panel's job is to send the right updates and
 * reflect the returned FlagSet. The "Disable all ordering" master button must
 * send every per-store ordering flag as false in one call.
 */

const setFlags = vi.fn()
vi.mock('#/lib/flags-server', () => ({
  setFlags: (...args: Array<unknown>) => setFlags(...args),
}))

beforeEach(() => {
  setFlags.mockReset()
})

describe('FlagsPanel', () => {
  it('toggles a single flag and sends just that update', async () => {
    // Jumbo visible starts off; setFlags echoes it back on.
    setFlags.mockResolvedValue(mergeFlags({ 'store.jumbo.visible': true }))
    render(<FlagsPanel initial={mergeFlags(null)} />)

    // Under defaults only Jumbo's "Selectable + priced" toggle reads Off (AH +
    // Picnic are visible), so this name matches exactly the Jumbo toggle.
    fireEvent.click(
      screen.getByRole('button', { name: /Selectable \+ priced: off/i }),
    )

    await waitFor(() => expect(setFlags).toHaveBeenCalledTimes(1))
    expect(setFlags).toHaveBeenCalledWith({
      data: { updates: [{ key: 'store.jumbo.visible', enabled: true }] },
    })
  })

  it('"Disable all ordering" sends every ordering flag as false', async () => {
    // Start with all ordering on so the button is enabled.
    setFlags.mockResolvedValue(
      mergeFlags({
        'store.ah.ordering': false,
        'store.jumbo.ordering': false,
        'store.picnic.ordering': false,
      }),
    )
    render(
      <FlagsPanel
        initial={mergeFlags({
          'store.ah.ordering': true,
          'store.jumbo.ordering': true,
          'store.picnic.ordering': true,
        })}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: /disable all ordering/i }),
    )

    await waitFor(() => expect(setFlags).toHaveBeenCalledTimes(1))
    const arg = setFlags.mock.calls[0]?.[0] as {
      data: { updates: Array<{ key: string; enabled: boolean }> }
    }
    expect(arg.data.updates).toEqual([
      { key: 'store.ah.ordering', enabled: false },
      { key: 'store.jumbo.ordering', enabled: false },
      { key: 'store.picnic.ordering', enabled: false },
    ])
  })

  it('disables the master button when no store can order', () => {
    // All ordering already off -> the "disable all ordering" button is a no-op.
    render(
      <FlagsPanel
        initial={mergeFlags({
          'store.ah.ordering': false,
          'store.jumbo.ordering': false,
          'store.picnic.ordering': false,
        })}
      />,
    )
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: /disable all ordering/i,
    })
    expect(button.disabled).toBe(true)
  })
})
