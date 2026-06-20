/**
 * In-Worker retrieval for the embedding ingredient -> product matcher (ADR-0003).
 *
 * Binds to Workers AI (bge-m3) + the `smart-cart-products` Vectorize index and
 * exposes a `retrieve` that `matchIngredientEmbedded` can consume. Kept thin and
 * binding-bound on purpose: the testable matching logic lives in `./match-embed`
 * with `retrieve` injected, exactly as `vectors/index.ts` keeps the live query
 * out of the unit-tested path.
 *
 * Vector ids are `${store}:${slug}` (see product-text.ts). We resolve each hit
 * back to the full normalised `StoreProduct` from the vendored catalogue rather
 * than stuffing every product field into Vectorize metadata, so price/size stay
 * the single source of truth in `catalogue.ts`.
 */

import { getCatalogue } from './catalogue'
import type { ProductCandidate, RetrieveFn } from './match-embed'
import type { StoreProduct } from './types'

interface Env {
  AI: Ai
  PRODUCTS_VECTORS: VectorizeIndex
}

async function env(): Promise<Env> {
  const { env: e } = await import('cloudflare:workers')
  return e as unknown as Env
}

/** Embed one query string to a 1024-dim vector via Workers AI bge-m3. */
async function embed(text: string): Promise<Array<number>> {
  const e = await env()
  const res = (await e.AI.run('@cf/baai/bge-m3', { text: [text] })) as {
    data: Array<Array<number>>
  }
  return res.data[0] ?? []
}

/** Pull the slug out of a `${store}:${slug}` vector id. */
function slugFromId(id: string, store: string): string | null {
  const prefix = `${store}:`
  if (!id.startsWith(prefix)) return null
  const slug = id.slice(prefix.length)
  return slug === '_' ? null : slug
}

/**
 * Retrieve top-K candidate products for an ingredient in a store.
 *
 * Filters the index query by store so a cross-store basket never leaks one
 * chain's products into another. Each match's id is resolved to a StoreProduct
 * from the catalogue; an id with no catalogue product (stale vector) is dropped.
 */
export const retrieve: RetrieveFn = async (name, store, topK) => {
  const e = await env()
  const vector = await embed(name)
  if (vector.length === 0) return []

  const res = await e.PRODUCTS_VECTORS.query(vector, {
    topK,
    filter: { store },
  })

  const catalogue = getCatalogue(store)
  if (!catalogue) return []
  const bySlug = new Map<string, StoreProduct>()
  for (const p of catalogue.products) {
    if (p.slug) bySlug.set(p.slug, p)
  }

  const out: Array<ProductCandidate> = []
  for (const m of res.matches) {
    const slug = slugFromId(m.id, store)
    if (!slug) continue
    const product = bySlug.get(slug)
    if (!product) continue
    out.push({ product, score: m.score })
  }
  return out
}
