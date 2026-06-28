import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REMOVED_AH_JUMBO_RECIPE_IDS } from '../lib/recipe-dinner'
import { recipeRowIsServable } from './recipe-filters'

interface SeedRow {
  id: string
  source: string
  title: string
  category: string | null
  imageUrl?: string | null
}

const SEED_PATH = join(process.cwd(), 'data', 'seed', 'recipes.json')

describe('recipeRowIsServable', () => {
  it('rejects removed non-dinner ids such as low-carb crackers', () => {
    expect(
      recipeRowIsServable({
        id: 'ah-R1197752',
        source: 'ah',
        title: 'Koolhydraatarme crackers',
        category: 'bijgerecht',
        raw: { imageUrl: '/stickers/recipes/ah-R1197752.png' },
      }),
    ).toBe(false)
  })

  it('keeps hoofdgerecht mains whose title contains saus', () => {
    expect(
      recipeRowIsServable({
        id: 'ah-R1201750',
        source: 'ah',
        title: 'Gnocchi met kip en pompoensaus uit de airfryer',
        category: 'hoofdgerecht',
        raw: { imageUrl: '/x.png' },
      }),
    ).toBe(true)
  })

  it('rejects title-only non-dinners on the removed blocklist', () => {
    expect(REMOVED_AH_JUMBO_RECIPE_IDS).toContain('jumbo-scraped-1781973822')
    expect(
      recipeRowIsServable({
        id: 'jumbo-scraped-1781973822',
        source: 'jumbo',
        title: 'Bananen-mango smoothie',
        category: null,
        raw: { imageUrl: '/x.png' },
      }),
    ).toBe(false)
  })
})

describe('AH + Jumbo seed rows are servable', () => {
  it('every dinner left in the seed passes recipeRowIsServable', () => {
    const all = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Array<SeedRow>
    const bad = all
      .filter((r) => r.source === 'ah' || r.source === 'jumbo')
      .filter(
        (r) =>
          !recipeRowIsServable({
            id: r.id,
            source: r.source,
            title: r.title,
            category: r.category,
            raw: { imageUrl: r.imageUrl ?? null },
          }),
      )
    expect(bad.map((r) => r.id)).toEqual([])
  })

  it('removed ids are not present in the seed file', () => {
    const all = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Array<SeedRow>
    const ids = new Set(all.map((r) => r.id))
    for (const id of REMOVED_AH_JUMBO_RECIPE_IDS) {
      expect(ids.has(id)).toBe(false)
    }
  })
})
