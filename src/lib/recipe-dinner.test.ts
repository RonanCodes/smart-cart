import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isDinnerRecipe } from './recipe-dinner'

interface SeedRow {
  id: string
  source: string
  title: string
  category: string | null
}

const SEED_PATH = join(process.cwd(), 'data', 'seed', 'recipes.json')

function ahJumboDinners(): Array<SeedRow> {
  const all = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Array<SeedRow>
  return all.filter((r) => r.source === 'ah' || r.source === 'jumbo')
}

describe('isDinnerRecipe', () => {
  it('keeps hoofdgerecht mains even when the title contains saus', () => {
    expect(
      isDinnerRecipe({
        title: 'Gnocchi met kip en pompoensaus uit de airfryer',
        category: 'hoofdgerecht',
      }),
    ).toBe(true)
  })

  it('drops Dutch side / breakfast / snack / dessert categories', () => {
    expect(
      isDinnerRecipe({
        title: 'Koolhydraatarme crackers',
        category: 'bijgerecht',
      }),
    ).toBe(false)
    expect(
      isDinnerRecipe({
        title: 'Chia overnight oats met amandel',
        category: 'ontbijt',
      }),
    ).toBe(false)
    expect(
      isDinnerRecipe({
        title: 'Kleurige zomerfruitijsjes',
        category: 'tussendoortje',
      }),
    ).toBe(false)
    expect(
      isDinnerRecipe({
        title: 'Ricottataart met aardbeien en frambozen',
        category: 'dessert',
      }),
    ).toBe(false)
  })

  it('drops title-only non-dinners when category is missing', () => {
    expect(
      isDinnerRecipe({
        title: 'Bananen-mango smoothie',
        category: null,
      }),
    ).toBe(false)
    expect(
      isDinnerRecipe({
        title: 'Chewy chocolade chip cookies',
        category: null,
      }),
    ).toBe(false)
    expect(
      isDinnerRecipe({
        title: 'Low carb kokosrepen',
        category: null,
      }),
    ).toBe(false)
    expect(
      isDinnerRecipe({
        title: 'Stroopwafelappeltaart met misokaramel',
        category: null,
      }),
    ).toBe(false)
    expect(
      isDinnerRecipe({
        title: 'Bloemkoolsalade met geroosterde oesterzwam Hugo Kennis',
        category: 'hoofdgerecht',
      }),
    ).toBe(false)
    expect(
      isDinnerRecipe({
        title: 'Romige zalmtartaar met coquille en limoengras',
        category: 'hoofdgerecht',
      }),
    ).toBe(false)
  })

  it('drops borrel and amuse categories', () => {
    expect(
      isDinnerRecipe({
        title: 'Smeuiige camembert uit de magnetron',
        category: 'borrel',
      }),
    ).toBe(false)
    expect(
      isDinnerRecipe({
        title: 'Gevulde guacamole-eieren',
        category: 'amuse',
      }),
    ).toBe(false)
  })
})

describe('AH + Jumbo seed catalogue is dinner-only', () => {
  it('every seeded supermarket recipe passes isDinnerRecipe', () => {
    const bad = ahJumboDinners().filter((r) => !isDinnerRecipe(r))
    expect(bad.map((r) => `${r.id}: ${r.title}`)).toEqual([])
  })
})
