import { describe, expect, it } from 'vitest'
import { recipeImageUrl } from './recipe-sticker'

describe('recipeImageUrl', () => {
  it('maps AH/Jumbo ids to public sticker paths', () => {
    expect(recipeImageUrl('ah-R1202259', 'https://static.ah.nl/foo.jpg')).toBe(
      '/stickers/recipes/ah-R1202259.png',
    )
    expect(
      recipeImageUrl(
        'jumbo-1000915',
        'https://recipe-service.prod.cloud.jumbo.com/x',
      ),
    ).toBe('/stickers/recipes/jumbo-1000915.png')
  })

  it('passes through other sources and null', () => {
    expect(recipeImageUrl('themealdb-52772', 'https://example.com/x.jpg')).toBe(
      'https://example.com/x.jpg',
    )
    expect(recipeImageUrl('ah-R1', null)).toBe(null)
  })
})
