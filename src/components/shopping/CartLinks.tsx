import { useState } from 'react'
import { ExternalLink, Loader2, ShoppingCart } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { buildCartLinks } from '#/lib/cart-links-server'
import type { CartLinksResult, StoreCartLink } from '#/lib/cart-links-server'

/**
 * "Add all to Albert Heijn / Jumbo" one-click cart buttons (#147).
 *
 * Each button resolves the household's shopping list to a public store
 * deep-link (no login, no credentials) and opens it in a new tab, so the user's
 * whole list lands in the store's cart in one tap. The resolution runs the
 * existing pricing matcher server-side; items it cannot place in a store are
 * skipped, and we surface "(N of M items)" so the user knows the match was
 * partial. A store with zero matches is disabled with a hint.
 *
 * Links are fetched lazily on first tap (one server call for both stores),
 * keeping the shopping-tab load cheap. Mobile-first (390px), iOS card styling.
 */
export function CartLinks() {
  const [links, setLinks] = useState<CartLinksResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  async function ensureLinks(): Promise<CartLinksResult | null> {
    if (links) return links
    setLoading(true)
    setError(false)
    try {
      const res = await buildCartLinks()
      setLinks(res)
      return res
    } catch {
      setError(true)
      return null
    } finally {
      setLoading(false)
    }
  }

  async function openStore(which: 'ah' | 'jumbo') {
    const res = await ensureLinks()
    const link = res?.[which]
    if (link?.url) {
      window.open(link.url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <section aria-labelledby="cart-links-heading" className="space-y-3">
      <div className="flex items-center gap-2">
        <ShoppingCart className="text-muted-foreground h-4 w-4" aria-hidden />
        <h2
          id="cart-links-heading"
          className="text-sm font-semibold tracking-tight"
        >
          Send to a store
        </h2>
      </div>

      <p className="text-muted-foreground/80 text-xs">
        Opens the store with your list pre-loaded into its cart. No login
        needed.
      </p>

      <div className="grid grid-cols-1 gap-2">
        <StoreButton
          label="Add all to Albert Heijn"
          link={links?.ah}
          loading={loading}
          onOpen={() => void openStore('ah')}
        />
        <StoreButton
          label="Add all to Jumbo"
          link={links?.jumbo}
          loading={loading}
          onOpen={() => void openStore('jumbo')}
        />
      </div>

      {error && (
        <p className="text-destructive text-xs" role="alert">
          Could not build the cart link. Try again.
        </p>
      )}
    </section>
  )
}

/**
 * One store's button. Before the lazy fetch resolves we show the bare label and
 * let the tap trigger the fetch + open. Once resolved we annotate it with
 * "(N of M items)" and disable it (with a hint) when nothing matched.
 */
function StoreButton({
  label,
  link,
  loading,
  onOpen,
}: {
  label: string
  link: StoreCartLink | undefined
  loading: boolean
  onOpen: () => void
}) {
  // Resolved but nothing matched: disable with a hint.
  const noMatch = link != null && link.url === null
  // A partial match: show "(N of M items)".
  const partial = link != null && link.url !== null && link.matched < link.total

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="pill"
        disabled={loading || noMatch}
        onClick={onOpen}
        aria-label={label}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <ExternalLink className="h-4 w-4" aria-hidden />
        )}
        <span>{label}</span>
        {partial && (
          <span className="text-muted-foreground text-xs font-normal">
            ({link.matched} of {link.total} items)
          </span>
        )}
      </Button>
      {noMatch && (
        <p className="text-muted-foreground/80 px-2 text-center text-xs">
          None of your items matched a {link.displayName} product yet.
        </p>
      )}
    </div>
  )
}
