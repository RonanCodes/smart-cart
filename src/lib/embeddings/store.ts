/**
 * Server-only loader for the embedding index. Reads the base64 vectors from D1
 * (store_product.embedding + recipe_embedding) once per isolate, decodes them,
 * and caches the result in a module-global. The first request per isolate pays a
 * ~few-MB read; every request after is in-memory, and a brute-force cosine over
 * the loaded set is sub-5ms at this catalogue size (ADR-0004).
 *
 * Binding-bound (uses getDb), so the testable matching logic lives in the pure
 * codec (topK) and the matchers, which take the loaded entries as input.
 */

import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { storeProduct } from '../../db/store-product-schema'
import { recipeEmbedding } from '../../db/recipe-embedding-schema'
import { decodeVector } from './codec'
import type { VectorEntry } from './codec'

/** A product vector entry: the store_product id, its store, the decoded vector. */
export interface ProductVectorEntry extends VectorEntry {
  store: string
}

let productCache: Promise<Array<ProductVectorEntry>> | null = null
const productStoreCache = new Map<string, Promise<Array<ProductVectorEntry>>>()
let recipeCache: Promise<Array<VectorEntry>> | null = null

async function loadProductVectors(): Promise<Array<ProductVectorEntry>> {
  const db = await getDb()
  const rows = await db
    .select({
      id: storeProduct.id,
      store: storeProduct.store,
      embedding: storeProduct.embedding,
    })
    .from(storeProduct)
    .where(isNotNull(storeProduct.embedding))
  const out: Array<ProductVectorEntry> = []
  for (const r of rows) {
    if (!r.embedding) continue
    out.push({ id: r.id, store: r.store, vector: decodeVector(r.embedding) })
  }
  return out
}

async function loadProductVectorsForStore(
  store: string,
): Promise<Array<ProductVectorEntry>> {
  const db = await getDb()
  const rows = await db
    .select({
      id: storeProduct.id,
      store: storeProduct.store,
      embedding: storeProduct.embedding,
    })
    .from(storeProduct)
    .where(
      and(
        eq(storeProduct.store, store.toLowerCase()),
        isNotNull(storeProduct.embedding),
      ),
    )
  const out: Array<ProductVectorEntry> = []
  for (const r of rows) {
    if (!r.embedding) continue
    out.push({ id: r.id, store: r.store, vector: decodeVector(r.embedding) })
  }
  return out
}

async function loadRecipeVectors(): Promise<Array<VectorEntry>> {
  const db = await getDb()
  const rows = await db
    .select({
      id: recipeEmbedding.recipeId,
      embedding: recipeEmbedding.embedding,
    })
    .from(recipeEmbedding)
  return rows.map((r) => ({ id: r.id, vector: decodeVector(r.embedding) }))
}

/** All product vectors, memoised per isolate. Filter by store at the call site. */
export function getProductVectors(): Promise<Array<ProductVectorEntry>> {
  if (!productCache) productCache = loadProductVectors()
  return productCache
}

/** Product vectors for one store (the cart/price path is always per store). */
export async function getProductVectorsForStore(
  store: string,
): Promise<Array<ProductVectorEntry>> {
  const key = store.toLowerCase()
  let cached = productStoreCache.get(key)
  if (!cached) {
    cached = loadProductVectorsForStore(key)
    productStoreCache.set(key, cached)
  }
  return cached
}

/** All recipe vectors, memoised per isolate. */
export function getRecipeVectors(): Promise<Array<VectorEntry>> {
  if (!recipeCache) recipeCache = loadRecipeVectors()
  return recipeCache
}

/** Map of recipe id -> vector, for "find the query recipe's own vector" lookups. */
export async function getRecipeVectorMap(): Promise<
  Map<string, Array<number>>
> {
  const entries = await getRecipeVectors()
  return new Map(entries.map((e) => [e.id, e.vector]))
}

/** Test/replan-seam hook: drop the per-isolate cache (used after a re-seed). */
export function resetEmbeddingCache(): void {
  productCache = null
  productStoreCache.clear()
  recipeCache = null
}
