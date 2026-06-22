/**
 * Generate AH add-multiple URLs for a meal plan (no auth, no dev server).
 *
 *   pnpm tsx scripts/generate-ah-links.ts b85694d4-4f88-4ba4-9cc8-984e32435fba
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { ProductVectorEntry } from '#/lib/embeddings/store'
import type { PlanRecipe } from '#/lib/shopping-server'
import { deriveShoppingView } from '#/lib/shopping-server'
import { pickTitle, pickIngredients } from '#/lib/recipe-locale'

function loadDevVars(): void {
  const path = join(process.cwd(), '.dev.vars')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

loadDevVars()

const SQLITE =
  process.env.D1_SQLITE ??
  join(
    process.cwd(),
    '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/e8d4e80c651bf51447d0bdb6241d6b918ba87d07979840be6767ad1337af4ea5.sqlite',
  )

function sqlJson<T>(query: string): T {
  const out = execSync(`sqlite3 -json '${SQLITE}' ${JSON.stringify(query)}`, {
    encoding: 'utf8',
  }).trim()
  if (!out) return [] as T
  return JSON.parse(out) as T
}

async function main() {
  const planId = process.argv[2]
  if (!planId) {
    console.error('Usage: pnpm tsx scripts/generate-ah-links.ts <planId>')
    process.exit(1)
  }

  const planRows = sqlJson<
    Array<{ plan: string; household_id: string; week_start: string }>
  >(
    `SELECT plan, household_id, week_start FROM meal_plan WHERE id = '${planId}'`,
  )
  const planRow = planRows[0]
  if (!planRow) {
    console.error('Plan not found:', planId)
    process.exit(1)
  }

  const hhRows = sqlJson<Array<{ adults: number; children: number }>>(
    `SELECT adults, children FROM household WHERE id = '${planRow.household_id}'`,
  )
  const hh = hhRows[0]!
  const days = JSON.parse(planRow.plan).days as Array<{ recipeRef?: string }>
  const ids = days.map((d) => d.recipeRef).filter(Boolean) as string[]
  const recipeRows = sqlJson<
    Array<{
      id: string
      title: string
      title_en: string | null
      servings: number | null
      ingredients: string
      ingredients_en: string | null
      quantities_estimated: number | null
    }>
  >(
    `SELECT id, title, title_en, servings, ingredients, ingredients_en, quantities_estimated FROM recipe WHERE id IN (${ids.map((id) => `'${id}'`).join(',')})`,
  )

  const recipesById = new Map<string, PlanRecipe>(
    recipeRows.map((r) => [
      r.id,
      {
        id: r.id,
        title: pickTitle(r.title, r.title_en),
        servings: r.servings,
        ingredients: pickIngredients(
          JSON.parse(r.ingredients),
          r.ingredients_en ? JSON.parse(r.ingredients_en) : null,
        ),
        quantitiesEstimated: !!r.quantities_estimated,
      },
    ]),
  )

  const { list } = deriveShoppingView(days, recipesById, {
    adults: hh.adults,
    children: hh.children,
  })

  const lines = list.lines.map((l) => ({
    name: l.name,
    amount:
      l.displayAmount && l.displayAmount !== '(unspecified amount)'
        ? l.displayAmount
        : null,
  }))

  const store = 'ah'
  const { decodeVector } = await import('#/lib/embeddings/codec')
  const { getCatalogue } = await import('#/lib/pricing/catalogue')
  const { storeProductId } = await import('#/lib/pricing/store-product-rows')
  const { selectCandidatesFromQueries, rerankMatch } =
    await import('#/lib/pricing/match-semantic')
  const { expandIngredientSearchTerms } =
    await import('#/lib/pricing/expand-ingredient')
  const { embedQueries } = await import('#/lib/embeddings/embed')
  const { models } = await import('#/lib/models')
  const { generateObject } = await import('#/lib/braintrust-ai')
  const { basketForStoreWithMatches, packsForAmount } =
    await import('#/lib/pricing/basket')
  const { buildAllItemsCartUrl } = await import('#/lib/cart-build')
  const { splitAmount } = await import('#/lib/pricing/resolve-lines')
  const { assertManifest } = await import('#/lib/embeddings/manifest')

  const dir = join(process.cwd(), 'data', 'embeddings')
  assertManifest(
    JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Parameters<
      typeof assertManifest
    >[0],
  )

  const rawVectors = JSON.parse(
    readFileSync(join(dir, 'products.json'), 'utf8'),
  ) as Array<{ id: string; store: string; v: string }>
  const entries: Array<ProductVectorEntry> = []
  for (const r of rawVectors) {
    if (r.store !== store) continue
    entries.push({ id: r.id, store: r.store, vector: decodeVector(r.v) })
  }

  const catalogue = getCatalogue(store)!
  const lookup = new Map(catalogue.products.map((p) => [storeProductId(p), p]))

  const resolved = await Promise.all(
    lines.map(async (line) => {
      try {
        const { terms } = await expandIngredientSearchTerms(line.name, {
          model: models.rerank,
          generateObject,
        })
        const vectors = await embedQueries(terms)
        const cands = selectCandidatesFromQueries(vectors, entries, lookup, 10)
        const { qty, unit } = splitAmount(line.amount)
        const { match } = await rerankMatch(
          { name: line.name, qty, unit },
          cands,
          store,
          { model: models.rerank, generateObject },
        )
        return { name: line.name, match }
      } catch {
        return {
          name: line.name,
          match: {
            store,
            product: null,
            priceCents: null,
            confidence: 'none' as const,
            estimated: true,
            score: 0,
          },
        }
      }
    }),
  )

  const basket = basketForStoreWithMatches(lines, resolved, catalogue)
  const cartItems = resolved.map(({ name, match }) => ({
    slug: match.product?.slug ?? null,
    qty:
      match.product != null
        ? packsForAmount(
            lines.find((l) => l.name === name)?.amount ?? null,
            match.product,
          )
        : undefined,
  }))
  const cart = buildAllItemsCartUrl(store, cartItems)
  const unmatched = resolved.filter((r) => !r.match.product)

  console.log(
    JSON.stringify(
      {
        planId,
        weekStart: planRow.week_start,
        consolidatedLines: lines.length,
        matched: basket.lineItems.length,
        unmatched: unmatched.length,
        displayTotalEur: (basket.totalCents / 100).toFixed(2),
        cartMatched: cart.matched,
        ahUrls: cart.urls,
        chunkSizes: cart.urls.map((u) => (u.match(/p=/g) ?? []).length),
        unmatchedNames: unmatched.map((u) => u.name),
        lines: basket.lineItems.map((li) => ({
          ingredient: li.ingredient,
          product: li.productName,
          packs: li.packs,
          lineEur: (li.lineCents / 100).toFixed(2),
        })),
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
