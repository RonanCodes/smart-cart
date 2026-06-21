import { describe, it, expect } from 'vitest'
import { pickTitle, pickInstructions, pickIngredients } from './recipe-locale'

describe('pickTitle', () => {
  it('prefers the English title when present', () => {
    expect(pickTitle('Risotto van bloemkool', 'Cauliflower risotto')).toBe(
      'Cauliflower risotto',
    )
  })
  it('falls back to Dutch when English is missing, null, or blank', () => {
    expect(pickTitle('Risotto van bloemkool')).toBe('Risotto van bloemkool')
    expect(pickTitle('Risotto van bloemkool', null)).toBe(
      'Risotto van bloemkool',
    )
    expect(pickTitle('Risotto van bloemkool', '   ')).toBe(
      'Risotto van bloemkool',
    )
  })
})

describe('pickInstructions', () => {
  it('prefers the English steps when the array is non-empty', () => {
    expect(pickInstructions(['Kook de rijst.'], ['Cook the rice.'])).toEqual([
      'Cook the rice.',
    ])
  })
  it('falls back to Dutch when English is missing, null, or empty', () => {
    expect(pickInstructions(['Kook de rijst.'])).toEqual(['Kook de rijst.'])
    expect(pickInstructions(['Kook de rijst.'], null)).toEqual([
      'Kook de rijst.',
    ])
    expect(pickInstructions(['Kook de rijst.'], [])).toEqual(['Kook de rijst.'])
  })
  it('returns empty when both are absent', () => {
    expect(pickInstructions(null, null)).toEqual([])
    expect(pickInstructions(undefined)).toEqual([])
  })
})

describe('pickIngredients', () => {
  const nl = [{ name: 'aardappelen', qty: '500', unit: 'g' }]
  const en = [{ name: 'potatoes', qty: '500', unit: 'g' }]

  it('prefers the English lines when non-empty', () => {
    expect(pickIngredients(nl, en)).toEqual(en)
  })
  it('falls back to Dutch when English is missing, null, or empty', () => {
    expect(pickIngredients(nl)).toEqual(nl)
    expect(pickIngredients(nl, null)).toEqual(nl)
    expect(pickIngredients(nl, [])).toEqual(nl)
  })
  it('returns empty when both are absent', () => {
    expect(pickIngredients(null, null)).toEqual([])
    expect(pickIngredients(undefined)).toEqual([])
  })
  it('preserves qty + unit on the English lines (quantities are language-agnostic)', () => {
    const out = pickIngredients(nl, en)
    expect(out[0]).toEqual({ name: 'potatoes', qty: '500', unit: 'g' })
  })
})

describe('locale toggle (#310)', () => {
  const nl = [{ name: 'aardappelen', qty: '500', unit: 'g' }]
  const en = [{ name: 'potatoes', qty: '500', unit: 'g' }]

  it("defaults to 'en' when no locale is passed (back-compatible)", () => {
    expect(pickTitle('Risotto van bloemkool', 'Cauliflower risotto')).toBe(
      'Cauliflower risotto',
    )
    expect(pickInstructions(['Kook de rijst.'], ['Cook the rice.'])).toEqual([
      'Cook the rice.',
    ])
    expect(pickIngredients(nl, en)).toEqual(en)
  })

  it("'en' shows the English translation when present", () => {
    expect(
      pickTitle('Risotto van bloemkool', 'Cauliflower risotto', 'en'),
    ).toBe('Cauliflower risotto')
    expect(
      pickInstructions(['Kook de rijst.'], ['Cook the rice.'], 'en'),
    ).toEqual(['Cook the rice.'])
    expect(pickIngredients(nl, en, 'en')).toEqual(en)
  })

  it("'nl' forces the Dutch source even when a translation exists", () => {
    expect(
      pickTitle('Risotto van bloemkool', 'Cauliflower risotto', 'nl'),
    ).toBe('Risotto van bloemkool')
    expect(
      pickInstructions(['Kook de rijst.'], ['Cook the rice.'], 'nl'),
    ).toEqual(['Kook de rijst.'])
    expect(pickIngredients(nl, en, 'nl')).toEqual(nl)
  })

  it("'en' still falls back to Dutch when there is no translation", () => {
    expect(pickTitle('Risotto van bloemkool', null, 'en')).toBe(
      'Risotto van bloemkool',
    )
    expect(pickInstructions(['Kook de rijst.'], null, 'en')).toEqual([
      'Kook de rijst.',
    ])
    expect(pickIngredients(nl, null, 'en')).toEqual(nl)
  })
})
