import { productUrl } from '#/lib/product-url'

/**
 * A small brand glyph that marks WHICH store a matched ingredient came from
 * (Albert Heijn or Jumbo), and, when a product slug is known, doubles as a
 * click-through to that product's page in a new tab.
 *
 * Reused on both the admin matching panel and the consumer shopping rows so the
 * brand mark + colour + accessible label never drift between the two surfaces.
 *
 * Brand colours mirror STORE_OPTIONS (src/lib/store-pref-server.ts) so the chip
 * matches the rest of the app: AH `#00ade6` on white, Jumbo `#eab90c` on black.
 *
 * Behaviour:
 *  - Unknown store (not 'ah' / 'jumbo'): renders nothing, so a row with no
 *    per-store match shows no glyph and never crashes.
 *  - Known store, no slug: a static chip with an accessible label ("Albert
 *    Heijn" / "Jumbo"), no link.
 *  - Known store + slug: an anchor opening the product page in a new tab,
 *    labelled "Open <name|product> at <store>".
 */

interface Brand {
  /** Human store name for the accessible label. */
  name: string
  /** Short glyph shown in the chip in lieu of a logo. */
  glyph: string
  /** Tailwind classes for the brand chip (background + text). */
  className: string
}

const BRANDS: Record<string, Brand> = {
  ah: {
    name: 'Albert Heijn',
    glyph: 'AH',
    className: 'bg-[#00ade6] text-white',
  },
  jumbo: { name: 'Jumbo', glyph: 'J', className: 'bg-[#eab90c] text-black' },
}

export function StoreBadge({
  store,
  slug = null,
  productName,
  className = '',
}: {
  /** The store the match came from ('ah' | 'jumbo'); anything else renders null. */
  store: string | null | undefined
  /** The matched product slug, for the click-through. Null = static chip. */
  slug?: string | null
  /** The matched product name, woven into the link's accessible label. */
  productName?: string | null
  /** Extra classes for the outer element (e.g. spacing from the caller). */
  className?: string
}) {
  const brand = store ? BRANDS[store.toLowerCase()] : undefined
  if (!brand) return null

  const chip = (
    <span
      className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1 text-[10px] leading-none font-bold ${brand.className}`}
      aria-hidden
    >
      {brand.glyph}
    </span>
  )

  const href = productUrl(store, slug)

  // No slug -> a static, labelled chip (still tells the reader the store).
  if (!href) {
    return (
      <span
        className={`inline-flex ${className}`}
        role="img"
        aria-label={brand.name}
        title={brand.name}
      >
        {chip}
      </span>
    )
  }

  const subject = productName?.trim() ? productName.trim() : 'product'
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // Generous tap target for touch (the chip itself is small).
      className={`inline-flex items-center rounded-md p-0.5 transition-opacity hover:opacity-80 ${className}`}
      aria-label={`Open ${subject} at ${brand.name} (opens in a new tab)`}
      title={`Open at ${brand.name}`}
      // The badge is often nested inside a clickable row; keep the click local.
      onClick={(e) => e.stopPropagation()}
    >
      {chip}
    </a>
  )
}
