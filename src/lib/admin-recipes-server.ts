import { createServerFn } from '@tanstack/react-start'

/**
 * Admin recipe-inspector data fns: list every recipe for the browse grid, and
 * load one recipe's detail (its ingredients matched to AH SKUs via the embedding
 * matcher). Admin-gated, server-only: every server import is lazy so none of it
 * (db, the matcher, the embed call) reaches the client bundle (the admin-server
 * / match-server pattern). Read-only reuse of the pricing matcher; the recsys /
 * planner / pricing core is untouched.
 */

/** One recipe card in the browse grid. */
export interface AdminRecipeCard {
  id: string
  title: string
  source: string
  cuisine: string | null
  imageUrl: string | null
}

/** Pull the recipe image out of the verbatim scraped blob (recipe.raw.imageUrl). */
function imageFromRaw(raw: Record<string, unknown> | null): string | null {
  if (!raw) return null
  const url = raw.imageUrl
  return typeof url === 'string' && url.trim() ? url.trim() : null
}

/** List every recipe, newest first, shaped for the browse grid. */
export const listAdminRecipes = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Array<AdminRecipeCard>> => {
    const { isAdmin } = await import('./admin-server')
    if (!(await isAdmin())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { recipe } = await import('../db/schema')
    const { desc } = await import('drizzle-orm')
    const db = await getDb()
    const rows = await db
      .select({
        id: recipe.id,
        title: recipe.title,
        source: recipe.source,
        cuisine: recipe.cuisine,
        raw: recipe.raw,
      })
      .from(recipe)
      .orderBy(desc(recipe.createdAt))
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      source: r.source,
      cuisine: r.cuisine,
      imageUrl: imageFromRaw(r.raw),
    }))
  },
)

/** One ingredient with its best AH product match (cheap cosine tier, no LLM). */
export interface IngredientSkuMatch {
  ingredient: string
  /** Matched product name, or null when nothing cleared the floor. */
  productName: string | null
  priceCents: number | null
  confidence: string
  slug: string | null
}

/** The full detail payload for one recipe. */
export interface AdminRecipeDetail {
  id: string
  title: string
  source: string
  cuisine: string | null
  imageUrl: string | null
  servings: number | null
  prepMinutes: number | null
  instructions: Array<string>
  matches: Array<IngredientSkuMatch>
  /** False when no OPENAI_API_KEY: ingredients show without SKU matches. */
  matchKeyPresent: boolean
}

/**
 * Load one recipe and match each of its ingredients to an AH SKU using the pure
 * matcher (selectCandidates + cheapMatch) over the D1 product vectors. The cheap
 * tier is one batched embed for all the ingredient lines plus an in-memory cosine
 * scan, so the whole detail loads in one round-trip, no per-line LLM. If the
 * embed call has no key or fails, ingredients are returned WITHOUT matches rather
 * than breaking the page (graceful degrade).
 */
export const getRecipeDetail = createServerFn({ method: 'GET' })
  .inputValidator((d: { recipeId: string }) => d)
  .handler(async ({ data }): Promise<AdminRecipeDetail | null> => {
    const { isAdmin } = await import('./admin-server')
    if (!(await isAdmin())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { recipe } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const rec = (
      await db
        .select()
        .from(recipe)
        .where(eq(recipe.id, data.recipeId))
        .limit(1)
    )[0]
    if (!rec) return null

    const ingredientNames = rec.ingredients
      .map((i) => i.name.trim())
      .filter((n) => Boolean(n))

    const base = {
      id: rec.id,
      title: rec.title,
      source: rec.source,
      cuisine: rec.cuisine,
      imageUrl: imageFromRaw(rec.raw),
      servings: rec.servings,
      prepMinutes: rec.prepMinutes,
      instructions: rec.instructions,
    }

    const matches = await matchIngredients(ingredientNames)
    return {
      ...base,
      matches: matches.matches,
      matchKeyPresent: matches.keyPresent,
    }
  })

/**
 * Match a list of ingredient names to AH SKUs (cheap cosine tier). One batched
 * embed for all lines, then a cosine top-K + cheapMatch per line over the loaded
 * D1 product vectors. Degrades to no-match (key absent or any error) so the
 * detail page always renders.
 */
async function matchIngredients(names: Array<string>): Promise<{
  matches: Array<IngredientSkuMatch>
  keyPresent: boolean
}> {
  const { embeddingKeyPresent } = await import('./embeddings/embed')
  const keyPresent = embeddingKeyPresent()
  const fallback = (): Array<IngredientSkuMatch> =>
    names.map((ingredient) => ({
      ingredient,
      productName: null,
      priceCents: null,
      confidence: 'none',
      slug: null,
    }))

  if (!keyPresent || names.length === 0) {
    return { matches: fallback(), keyPresent }
  }

  try {
    const { embedQueries } = await import('./embeddings/embed')
    const { getProductVectorsForStore } = await import('./embeddings/store')
    const { getCatalogue } = await import('./pricing/catalogue')
    const { storeProductId } = await import('./pricing/store-product-rows')
    const { selectCandidates, cheapMatch } =
      await import('./pricing/match-semantic')

    const store = 'ah'
    const [vectors, entries] = await Promise.all([
      embedQueries(names),
      getProductVectorsForStore(store),
    ])
    const catalogue = getCatalogue(store)
    const lookup = new Map(
      (catalogue?.products ?? []).map((p) => [storeProductId(p), p]),
    )

    const matches = names.map((ingredient, i): IngredientSkuMatch => {
      const qv = vectors[i]
      if (!qv) {
        return {
          ingredient,
          productName: null,
          priceCents: null,
          confidence: 'none',
          slug: null,
        }
      }
      const candidates = selectCandidates(qv, entries, lookup, 10)
      const hit = cheapMatch(store, candidates)
      return {
        ingredient,
        productName: hit.product?.name ?? null,
        priceCents: hit.priceCents,
        confidence: hit.confidence,
        slug: hit.product?.slug ?? null,
      }
    })
    return { matches, keyPresent }
  } catch {
    // Matching is best-effort: show ingredient names without a match rather than
    // break the detail page (the brief's graceful-degrade requirement).
    return { matches: fallback(), keyPresent }
  }
}
