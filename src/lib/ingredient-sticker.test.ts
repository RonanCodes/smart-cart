import { describe, it, expect } from 'vitest'
import { ingredientSticker } from './ingredient-sticker'

describe('ingredientSticker', () => {
  it('matches real, messy list names on a keyword', () => {
    expect(ingredientSticker('Vine tomatoes')).toBe(
      '/stickers/ingredients/tomato.png',
    )
    expect(ingredientSticker('Salmon fillet')).toBe(
      '/stickers/ingredients/fish.png',
    )
    expect(ingredientSticker('Extra-virgin olive oil')).toBe(
      '/stickers/ingredients/olive-oil.png',
    )
  })

  it('matches simple plurals', () => {
    expect(ingredientSticker('Eggs')).toBe('/stickers/ingredients/egg.png')
    expect(ingredientSticker('Lemons')).toBe('/stickers/ingredients/lemon.png')
  })

  it('does not bleed a short keyword into a longer unrelated word', () => {
    // "egg" must not match "eggplant", "nut" must not match "butternut".
    expect(ingredientSticker('Eggplant')).toBeNull()
    expect(ingredientSticker('Butternut squash')).toBeNull()
  })

  it('keeps the explicitly-listed nut compounds', () => {
    expect(ingredientSticker('Roasted peanuts')).toBe(
      '/stickers/ingredients/nuts.png',
    )
  })

  it('returns null when nothing matches', () => {
    expect(ingredientSticker('Toilet paper')).toBeNull()
  })
})
