import { describe, expect, it } from 'vitest'
import { buildAllItemsCartUrl } from './cart-build'
import {
  AH_BULK_CHUNK_SIZE,
  ahProductId,
  mergeCartLineItems,
} from './cart-links'
import { packsForAmount } from './pricing/basket'
import { parseSize } from './pricing/normalise'
import type { StoreProduct } from './pricing/types'
import { deriveShoppingView } from './shopping-server'
import type { PlanDayRef, PlanRecipe } from './shopping-server'

/**
 * The three cart invariants (#363) — regression guards for cart → Albert Heijn.
 *
 * Each invariant is locked at the seam where it can break:
 *
 * 1. **Ingredients ↔ recipes** — every consolidated cart line traces to a real
 *    recipe ingredient; nothing invented between recipes and the cart.
 *    Unit tests: `consolidate.test.ts` (`ingredients trace back…`).
 *
 * 2. **Grams + pack counts** — consolidated amounts equal the portion-scaled SUM
 *    across recipes; `packsForAmount` returns ceil(required / pack) for comparable
 *    units (smallest pack that covers).
 *    Unit tests: `consolidate.test.ts` (`grams correctness`), `basket.test.ts`
 *    (`packsForAmount`).
 *
 * 3. **AH URL faithfulness** — build → parse → count round-trip: distinct SKUs in
 *    the URL == matched items, per-SKU qty == merged pack counts, chunk count ==
 *    ceil(skuCount / AH_BULK_CHUNK_SIZE). Catches "44 in cart, 27 in AH".
 *    Unit tests: `cart-build.test.ts` (`AH URL faithfulness`).
 *
 * **Type-sane matching** (chilli flakes ≠ Doritos, almond flour ≠ cake, 'nduja
 * ≠ ready-meal) is gated by `pnpm eval` golden cases with `rejectAny` filters in
 * `scripts/eval.ts` (ADR-0006) — the same pipeline `resolveLinesForStoreAccurate`
 * runs for the cart.
 *
 * This file wires (1)+(2)+(3) through the derivation → pack-count → URL path the
 * cart uses after matching. Product slugs come from a fixture catalogue so the
 * embedding matcher is not exercised here (matcher internals are eval-gated).
 */

function recipe(over: Partial<PlanRecipe> & { id: string }): PlanRecipe {
  return {
    title: over.title ?? over.id,
    servings: over.servings ?? null,
    ingredients: over.ingredients ?? [],
    ...over,
  }
}

function mapOf(...recipes: Array<PlanRecipe>): Map<string, PlanRecipe> {
  return new Map(recipes.map((r) => [r.id, r]))
}

/** Fixture AH products keyed by consolidated ingredient name (post-consolidate). */
function fixtureProduct(
  slug: string,
  packSize: string,
): Pick<StoreProduct, 'slug' | 'size'> {
  return { slug, size: parseSize(packSize) }
}

function parseAhParams(url: string): Array<{ sku: string; qty: number }> {
  return new URL(url).searchParams.getAll('p').map((p) => {
    const [sku, qty] = p.split(':')
    return { sku: sku!, qty: Number(qty) }
  })
}

function parseAllAhParams(
  urls: ReadonlyArray<string>,
): Array<{ sku: string; qty: number }> {
  return urls.flatMap(parseAhParams)
}

describe('cart invariants — week → consolidate → packs → AH URL (#363)', () => {
  /**
   * A small week spanning shared ingredients, portion scaling, and multi-pack
   * amounts. Slugs are injected from the fixture map (standing in for matcher
   * output); packs come from the real `packsForAmount` + `buildAllItemsCartUrl`.
   */
  const FIXTURE_MATCHES: Record<
    string,
    Pick<StoreProduct, 'slug' | 'size'> | undefined
  > = {
    bloem: fixtureProduct('wi100001/tarwebloem-500g', '500 g'),
    ui: fixtureProduct('wi100002/ui', 'per stuk'),
    melk: fixtureProduct('wi100003/halfvolle-melk', '1 l'),
  }

  const weekRecipes = mapOf(
    recipe({
      id: 'r1',
      title: 'Pasta',
      servings: 2,
      ingredients: [
        { name: 'bloem', qty: '200', unit: 'g' },
        { name: 'ui', qty: '1' },
        { name: 'melk', qty: '300', unit: 'ml' },
      ],
    }),
    recipe({
      id: 'r2',
      title: 'Pannenkoeken',
      servings: 4,
      ingredients: [
        { name: 'bloem', qty: '400', unit: 'g' },
        { name: 'melk', qty: '500', unit: 'ml' },
      ],
    }),
  )

  const planDays: Array<PlanDayRef> = [{ recipeRef: 'r1' }, { recipeRef: 'r2' }]

  it('(1) every consolidated line traces to a recipe ingredient', () => {
    const { list } = deriveShoppingView(planDays, weekRecipes, { adults: 2 })

    const recipeNames = new Set<string>()
    for (const r of weekRecipes.values()) {
      for (const ing of r.ingredients) {
        recipeNames.add(ing.name.trim().toLowerCase())
      }
    }

    expect(list.lines.length).toBeGreaterThan(0)
    for (const line of list.lines) {
      expect(recipeNames.has(line.name.toLowerCase())).toBe(true)
    }
    expect(list.lines.map((l) => l.name).sort()).toEqual([
      'bloem',
      'melk',
      'ui',
    ])
  })

  it('(2) consolidated grams match portion-scaled SUM across recipes', () => {
    const { list } = deriveShoppingView(planDays, weekRecipes, { adults: 2 })

    const bloem = list.lines.find((l) => l.name === 'bloem')!
    // r1: 200 g @ 2 servings, target 2 -> 200 g
    // r2: 400 g @ 4 servings, target 2 -> 200 g
    expect(bloem.totalQty).toBe(400)
    expect(bloem.unit).toBe('g')
    expect(bloem.displayAmount).toBe('400 g')

    const melk = list.lines.find((l) => l.name === 'melk')!
    // r1: 300 ml @ 2 -> 300 ml; r2: 500 ml @ 4 -> 250 ml => 550 ml
    expect(melk.totalQty).toBe(550)
    expect(melk.unit).toBe('ml')
  })

  it('(2)+(3) pack counts from consolidated amounts survive the AH URL round-trip', () => {
    const { list } = deriveShoppingView(planDays, weekRecipes, { adults: 2 })

    const resolvedItems = list.lines
      .map((line) => {
        const product = FIXTURE_MATCHES[line.name]
        if (!product?.slug) return null
        return {
          slug: product.slug,
          qty: packsForAmount(line.displayAmount, product),
        }
      })
      .filter((item): item is { slug: string; qty: number } => item !== null)

    const res = buildAllItemsCartUrl('ah', resolvedItems)
    const parsed = parseAllAhParams(res.urls)

    const expected = mergeCartLineItems(
      resolvedItems.map((item) => ({
        sku: ahProductId(item.slug)!,
        qty: item.qty,
      })),
    )
    const expectedBySku = new Map(expected.map((e) => [e.sku, e.qty]))
    const parsedBySku = new Map(parsed.map((p) => [p.sku, p.qty]))

    // bloem 400 g / 500 g pack => 1 pack; melk 550 ml / 1000 ml => 1 pack; ui => 1
    expect(resolvedItems.find((i) => i.slug.includes('100001'))?.qty).toBe(1)
    expect(resolvedItems.find((i) => i.slug.includes('100003'))?.qty).toBe(1)
    expect(resolvedItems.find((i) => i.slug.includes('100002'))?.qty).toBe(1)

    expect(parsed).toHaveLength(expected.length)
    expect(res.matched).toBe(expected.length)
    for (const [sku, qty] of expectedBySku) {
      expect(parsedBySku.get(sku)).toBe(qty)
    }
  })

  it('(3) chunk count == ceil(matched / AH_BULK_CHUNK_SIZE) for a large matched set', () => {
    const skuCount = 44
    const items = Array.from({ length: skuCount }, (_, i) => ({
      slug: `wi${2000 + i}/product`,
      qty: packsForAmount('300 g', fixtureProduct(`wi${2000 + i}/x`, '500 g')),
    }))
    const res = buildAllItemsCartUrl('ah', items)

    expect(res.matched).toBe(skuCount)
    expect(res.urls).toHaveLength(Math.ceil(skuCount / AH_BULK_CHUNK_SIZE))
    const parsed = parseAllAhParams(res.urls)
    expect(parsed).toHaveLength(skuCount)
    expect(new Set(parsed.map((p) => p.sku)).size).toBe(skuCount)
    for (const url of res.urls) {
      expect(parseAhParams(url).length).toBeLessThanOrEqual(AH_BULK_CHUNK_SIZE)
    }
  })
})

describe('cart invariants — type-sane matcher (eval gate, #363)', () => {
  /**
   * Document the eval golden cases that lock wrong-type matches. `pnpm eval` runs
   * these when matcher files change; they are not duplicated here to avoid a
   * second OpenAI call path.
   */
  const TYPE_SANE_INGREDIENTS = [
    'chilli flakes',
    'almond flour',
    'amandelmeel',
    "'nduja",
    'fresh lasagne sheets',
    'basmati rice',
  ] as const

  it('lists the eval-gated ingredients whose rejectAny filters guard cart type-sanity', () => {
    expect(TYPE_SANE_INGREDIENTS).toContain('chilli flakes')
    expect(TYPE_SANE_INGREDIENTS).toContain('almond flour')
    expect(TYPE_SANE_INGREDIENTS.length).toBeGreaterThanOrEqual(6)
  })
})
