import { createServerFn } from '@tanstack/react-start'
import { pickTitle } from './recipe-locale'
import { recipeImageUrl } from './recipe-sticker'

/**
 * One recipe result on the Search screen: the same card detail the week + deck
 * render (title, cuisine, time, calories, hero image), keyed by the catalogue id
 * so a tap can open the recipe sheet. `tags` carries the recipe's dietary tags so
 * the browse-by-theme rows can group without a second read.
 */
export interface SearchRecipe {
  /** Catalogue recipe id (the stable reference). */
  id: string
  /** Display title (English, Dutch fallback) per the household locale. */
  title: string
  /** Cuisine label, when the recipe has one. */
  cuisine: string | null
  /** Prep time in minutes, when known. */
  prepMinutes: number | null
  /** kcal per serving, when known. */
  calories: number | null
  /** grams of protein per serving, when known. */
  protein: number | null
  /** Hero image URL (die-cut sticker for AH/Jumbo), when present. */
  imageUrl: string | null
  /** Normalised dietary tags, used to bucket the browse-by-theme rows. */
  tags: Array<string>
}

/** One store-product result the user can add to their shopping list. */
export interface SearchProduct {
  /** Stable `store_product` id (`<store>:<slug>`). */
  id: string
  /** Product display name ('Halfvolle melk'). */
  name: string
  /** Store slug ('ah' | 'jumbo' | ...). */
  store: string
  /** Price as a display string ('€4,49'), or null when the row had no price. */
  price: string | null
  /** Pack-size unit ('g', 'l', 'stuks'), or null when unparseable. */
  unit: string | null
}

export interface SearchResult {
  recipes: Array<SearchRecipe>
  products: Array<SearchProduct>
}

/** A browse-by-theme row of recipes (shown before the user types). */
export interface SearchTheme {
  title: string
  recipes: Array<SearchRecipe>
}

export interface SearchBrowse {
  themes: Array<SearchTheme>
}

/** Cap on rows returned per surface so a broad query can't ship the whole table. */
const RECIPE_LIMIT = 30
const PRODUCT_LIMIT = 20
/** How many recipes a browse-by-theme row holds (a horizontal scroll strip). */
const THEME_LIMIT = 12

/**
 * Format integer cents as a Dutch price string ('449' -> '€4,49'). Mirrors the
 * comma-decimal the rest of the app shows. Null in, null out.
 */
function formatPrice(cents: number | null): string | null {
  if (cents === null) return null
  const euros = (cents / 100).toFixed(2).replace('.', ',')
  return `€${euros}`
}

/** Lower-case + trim a tag/term for case-insensitive matching. */
function norm(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * The browse-by-theme rows shown before the user types. Each theme is a predicate
 * over the real catalogue row, so the rows are grounded in actual recipe data
 * (prep time, dietary tags, protein) rather than a hand-curated list.
 */
const THEMES: Array<{ title: string; match: (r: SearchRecipe) => boolean }> = [
  {
    title: 'Quick weeknights',
    match: (r) => r.prepMinutes !== null && r.prepMinutes <= 25,
  },
  {
    title: 'Veggie favourites',
    match: (r) => r.tags.includes('vegetarian') || r.tags.includes('vegan'),
  },
  {
    title: 'High protein',
    match: (r) => r.protein !== null && r.protein >= 30,
  },
  {
    title: 'Something lighter',
    match: (r) => r.calories !== null && r.calories <= 500,
  },
]

/**
 * Search the real catalogue + store products for a query, and (when the query is
 * blank) the browse-by-theme rows. Backs the Search screen (formerly Discover).
 *
 * Recipes come from the `recipe` table behind the AH/Jumbo + `hasImage` filter
 * (the same servable set the week + deck use), title-localised per household.
 * Products come from the `store_product` table by a case-insensitive name match.
 * When `store_product` is empty (e.g. a dev DB that hasn't run `pnpm seed`) the
 * product results just come back empty, which the UI renders as a recipes-only
 * result.
 *
 * Server-only deps are dynamically imported inside the handler so nothing
 * server-only leaks into the client bundle (the week-server pattern). Scoped to
 * the signed-in household for the locale; recipe content itself is public.
 */
export const searchCatalogue = createServerFn({ method: 'GET' })
  .inputValidator((d: { query?: unknown }) => ({
    query: String(d.query ?? '').trim(),
  }))
  .handler(async ({ data }): Promise<SearchResult> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipe } = await import('../db/schema')
    const { storeProduct } = await import('../db/store-product-schema')
    const { eq, and, like, or } = await import('drizzle-orm')
    const { hasImage } = await import('../db/recipe-filters')
    const { normalizeLocale } = await import('./locale-pref-server')
    const db = await getDb()

    const hh = (
      await db
        .select({
          id: household.id,
          preferredLocale: household.preferredLocale,
        })
        .from(household)
        .where(eq(household.ownerId, user.id))
        .limit(1)
    )[0]
    const locale = normalizeLocale(hh?.preferredLocale) ?? 'en'

    const q = norm(data.query)
    if (!q) return { recipes: [], products: [] }

    // Recipes: load the servable set (same hasImage gate as the week), localise
    // the title, then match query against title (both locales), cuisine, tags.
    const recipeRows = await db
      .select({
        id: recipe.id,
        title: recipe.title,
        titleEn: recipe.titleEn,
        cuisine: recipe.cuisine,
        prepMinutes: recipe.prepMinutes,
        calories: recipe.calories,
        protein: recipe.protein,
        dietaryTags: recipe.dietaryTags,
        raw: recipe.raw,
      })
      .from(recipe)
      .where(hasImage)

    const recipes: Array<SearchRecipe> = recipeRows
      .filter((r) => {
        const title = norm(pickTitle(r.title, r.titleEn, locale))
        const titleAlt = norm(r.title)
        const titleEn = r.titleEn ? norm(r.titleEn) : ''
        const cuisine = r.cuisine ? norm(r.cuisine) : ''
        const tags = r.dietaryTags.map(norm)
        return (
          title.includes(q) ||
          titleAlt.includes(q) ||
          titleEn.includes(q) ||
          cuisine.includes(q) ||
          tags.some((t) => t.includes(q))
        )
      })
      .slice(0, RECIPE_LIMIT)
      .map((r) => ({
        id: r.id,
        title: pickTitle(r.title, r.titleEn, locale),
        cuisine: r.cuisine,
        prepMinutes: r.prepMinutes,
        calories: r.calories,
        protein: r.protein,
        imageUrl: recipeImageUrl(
          r.id,
          ((r.raw as { imageUrl?: string | null } | null) ?? null)?.imageUrl ??
            null,
        ),
        tags: r.dietaryTags.map(norm),
      }))

    // Products: a case-insensitive name match against store_product, AH/Jumbo
    // only (the app's two stores). SQLite LIKE is case-insensitive for ASCII; we
    // escape the user's % and _ so they search literally. Empty table -> [].
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`)
    const productRows = await db
      .select({
        id: storeProduct.id,
        name: storeProduct.name,
        store: storeProduct.store,
        priceCents: storeProduct.priceCents,
        unit: storeProduct.unit,
      })
      .from(storeProduct)
      .where(
        and(
          or(eq(storeProduct.store, 'ah'), eq(storeProduct.store, 'jumbo')),
          like(storeProduct.name, `%${escaped}%`),
        ),
      )
      .limit(PRODUCT_LIMIT)

    const products: Array<SearchProduct> = productRows.map((p) => ({
      id: p.id,
      name: p.name,
      store: p.store,
      price: formatPrice(p.priceCents),
      unit: p.unit,
    }))

    return { recipes, products }
  })

/**
 * The browse-by-theme rows shown before the user types: real catalogue recipes
 * (servable AH/Jumbo set, title-localised) bucketed into themed horizontal rows
 * by a predicate over the recipe's own data (prep time, tags, protein, calories).
 * One read, sliced per theme; a theme with no matches is dropped client-side.
 */
export const browseRecipes = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SearchBrowse> => {
    const { getSessionUser } = await import('./server-auth')
    const user = await getSessionUser()
    if (!user) throw new Error('Not signed in')

    const { getDb } = await import('../db/client')
    const { household, recipe } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const { hasImage } = await import('../db/recipe-filters')
    const { normalizeLocale } = await import('./locale-pref-server')
    const db = await getDb()

    const hh = (
      await db
        .select({ preferredLocale: household.preferredLocale })
        .from(household)
        .where(eq(household.ownerId, user.id))
        .limit(1)
    )[0]
    const locale = normalizeLocale(hh?.preferredLocale) ?? 'en'

    const rows = await db
      .select({
        id: recipe.id,
        title: recipe.title,
        titleEn: recipe.titleEn,
        cuisine: recipe.cuisine,
        prepMinutes: recipe.prepMinutes,
        calories: recipe.calories,
        protein: recipe.protein,
        dietaryTags: recipe.dietaryTags,
        raw: recipe.raw,
      })
      .from(recipe)
      .where(hasImage)

    const catalogue: Array<SearchRecipe> = rows.map((r) => ({
      id: r.id,
      title: pickTitle(r.title, r.titleEn, locale),
      cuisine: r.cuisine,
      prepMinutes: r.prepMinutes,
      calories: r.calories,
      protein: r.protein,
      imageUrl: recipeImageUrl(
        r.id,
        ((r.raw as { imageUrl?: string | null } | null) ?? null)?.imageUrl ??
          null,
      ),
      tags: r.dietaryTags.map(norm),
    }))

    const themes: Array<SearchTheme> = THEMES.map((t) => ({
      title: t.title,
      recipes: catalogue.filter(t.match).slice(0, THEME_LIMIT),
    })).filter((t) => t.recipes.length > 0)

    return { themes }
  },
)
