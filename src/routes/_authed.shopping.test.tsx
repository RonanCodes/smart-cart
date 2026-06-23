import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ShoppingBootstrap } from '#/lib/shopping-server'

/**
 * Stale-after-clear regression on /shopping (user repro).
 *
 * The route reuses its loader result on back-nav within 30s (staleTime, #251).
 * "Clear all" persists server-side, but the clear path did NOT invalidate that
 * cached loader result, so navigating back within 30s rendered the stale
 * pre-clear bootstrap, and the first tap snapped the view to the true (empty)
 * persisted state — "the old data is cached for the view".
 *
 * The fix: after a successful clear the route must call `router.invalidate()`
 * (the EditableShoppingList `onCleared` hook), so a re-load reflects the cleared
 * list immediately. This test renders the real route component and asserts that
 * triggering the list's `onCleared` invalidates the router.
 */

// Capture the onCleared the route hands to the list, plus the router.invalidate spy.
const invalidate = vi.fn(() => Promise.resolve())
let capturedOnCleared: (() => void) | undefined

vi.mock('@tanstack/react-router', () => ({
  // Return the route options object so `Route.component` is the Shopping fn, and
  // expose the hooks Shopping calls on `Route`.
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useLoaderData: () => loaderData,
  }),
  useRouter: () => ({ invalidate }),
  // TabBar (mounted via AppShell) reads the current path through this.
  useRouterState: () => '/shopping',
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

// Stub the list so we can grab the onCleared prop the route passes it. The real
// list's clear behaviour is covered by EditableShoppingList.test.tsx.
vi.mock('#/components/shopping/EditableShoppingList', () => ({
  EditableShoppingList: (props: { onCleared?: () => void }) => {
    capturedOnCleared = props.onCleared
    return (
      <button type="button" onClick={() => props.onCleared?.()}>
        clear-all-proxy
      </button>
    )
  },
}))

// Quiet the other children + hooks the route mounts; none are under test here.
vi.mock('#/components/shopping/StaplesSection', () => ({
  StaplesSection: () => <div data-testid="staples" />,
}))
vi.mock('#/components/shopping/CartStoreSwitch', () => ({
  CartStoreSwitch: () => <div />,
}))
vi.mock('#/components/shopping/FloatingOrderBar', () => ({
  FloatingOrderBar: () => <div />,
}))
vi.mock('#/lib/use-price-comparison', () => ({
  usePriceComparison: () => ({
    data: null,
    loading: false,
    failed: false,
    storePendingLineKeys: {},
  }),
  priceMapForStore: () => new Map(),
  lineKey: (l: { name: string; amount?: string | null }) =>
    `${l.name}|${l.amount ?? ''}`,
}))

// eslint-disable-next-line import/first -- must import after the vi.mock calls above
import { Route } from './_authed.shopping'

function bootstrap(over: Partial<ShoppingBootstrap> = {}): ShoppingBootstrap {
  return {
    view: {
      list: { lines: [] },
      waste: { hasSavings: false, sharedIngredientCount: 0 },
      missingPlanId: false,
      amountsEstimated: false,
    },
    staples: [],
    frequentlyBought: [],
    items: [
      {
        id: 'a',
        name: 'tomaten',
        amount: '500 g',
        unit: null,
        checked: true,
        source: 'recipe',
        createdAt: Date.now(),
      },
    ],
    preferredStore: 'ah',
    ...over,
  } as ShoppingBootstrap
}

let loaderData: ShoppingBootstrap

beforeEach(() => {
  invalidate.mockClear()
  capturedOnCleared = undefined
  loaderData = bootstrap()
})

describe('/shopping route — clear-all invalidates the loader cache', () => {
  it('invalidates the router when the list is cleared, so back-nav within 30s is not stale', async () => {
    const Shopping = (Route as unknown as { component: () => React.ReactNode })
      .component
    render(<Shopping />)

    // The route must wire an onCleared into the list. Without it the cleared
    // loader cache survives staleTime and the stale list reappears on back-nav.
    expect(capturedOnCleared).toBeTypeOf('function')

    fireEvent.click(screen.getByText('clear-all-proxy'))

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1))
  })
})
