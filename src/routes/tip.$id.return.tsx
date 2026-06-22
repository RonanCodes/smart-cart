import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { AppShell, ScreenHeader } from '#/components/ui/app-shell'
import { Button } from '#/components/ui/button'
import { buildCartLinks } from '#/lib/cart-links-server'
import { openStoreCart } from '#/lib/open-store-cart'
import { isOpenableCartLink, takePendingCart } from '#/lib/pending-cart'
import { log } from '#/lib/log'

/**
 * Landing page after the Mollie hosted-checkout redirect for a tip
 * (redirectUrl = /tip/{id}/return?store=ah). Pay-first flow: the cart link was
 * stashed before redirect; we open the store cart here after payment.
 */
export const Route = createFileRoute('/tip/$id/return')({
  validateSearch: (s: Record<string, unknown>): { store?: 'ah' | 'jumbo' } => ({
    store: s.store === 'ah' || s.store === 'jumbo' ? s.store : undefined,
  }),
  component: TipReturn,
})

function TipReturn() {
  const { id } = Route.useParams()
  const { store } = Route.useSearch()
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(false)
  const autoOpenStarted = useRef(false)
  const label = store === 'jumbo' ? 'Jumbo' : 'Albert Heijn'

  async function openCartFromStashOrRebuild(): Promise<boolean> {
    if (!store) return false
    const pending = takePendingCart(id)
    if (pending) {
      openStoreCart(pending)
      return true
    }
    try {
      const link = (await buildCartLinks({ data: { store } })) as unknown
      if (isOpenableCartLink(link)) {
        openStoreCart(link)
        return true
      }
    } catch (err) {
      log.error('tip.return_open_cart_failed', err, { store })
    }
    return false
  }

  useEffect(() => {
    if (!store || autoOpenStarted.current) return
    autoOpenStarted.current = true
    void (async () => {
      setBusy(true)
      const ok = await openCartFromStashOrRebuild()
      if (ok) setOpened(true)
      setBusy(false)
    })()
  }, [id, store])

  async function openCart() {
    setBusy(true)
    try {
      if (await openCartFromStashOrRebuild()) setOpened(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <ScreenHeader title="Thanks!" />
      <div className="flex flex-col items-center gap-4 px-5 pt-10 text-center">
        <div
          className="bg-secondary text-primary flex h-20 w-20 items-center justify-center rounded-full"
          aria-hidden
        >
          <Heart className="h-9 w-9" fill="currentColor" />
        </div>
        <p className="text-sm font-medium">Thanks for supporting Souso!</p>
        <p className="text-muted-foreground text-xs">
          {store
            ? opened
              ? `Your basket is opening in ${label}.`
              : `Tap below if your ${label} basket did not open.`
            : 'Your basket is ready in your store. Happy cooking.'}
        </p>
        {store && !opened && (
          <Button size="pill" disabled={busy} onClick={() => void openCart()}>
            {busy ? 'Opening…' : `Open my ${label} cart`}
          </Button>
        )}
        <Link to="/shopping">
          <Button variant="outline" size="pill">
            Back to shopping
          </Button>
        </Link>
      </div>
    </AppShell>
  )
}
