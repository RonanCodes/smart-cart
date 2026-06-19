import { describe, expect, it } from 'vitest'
import { recipeText } from './recipe-text'

describe('recipeText', () => {
  it('joins title, cuisine, and ingredient names (ADR-0001)', () => {
    const text = recipeText({
      title: 'Adana kebab',
      cuisine: 'Turkish',
      ingredients: [
        { name: 'Lamb Mince' },
        { name: 'Red Pepper Paste' },
        { name: 'Romano Pepper' },
      ],
    })
    expect(text).toBe(
      'Adana kebab. Turkish. Lamb Mince, Red Pepper Paste, Romano Pepper',
    )
  })

  it('excludes recipe steps entirely', () => {
    // recipeText has no steps parameter, so steps can never leak into the vector.
    const text = recipeText({
      title: 'Pad Thai',
      cuisine: 'Thai',
      ingredients: [{ name: 'rice noodles' }],
    })
    expect(text).not.toMatch(/step/i)
    expect(text).toBe('Pad Thai. Thai. rice noodles')
  })

  it('drops a null cuisine without leaving a dangling separator', () => {
    const text = recipeText({
      title: 'Mystery dish',
      cuisine: null,
      ingredients: [{ name: 'flour' }, { name: 'water' }],
    })
    expect(text).toBe('Mystery dish. flour, water')
    expect(text).not.toContain('. . ')
  })

  it('handles a recipe with no ingredients', () => {
    const text = recipeText({
      title: 'Plain rice',
      cuisine: 'Japanese',
      ingredients: [],
    })
    expect(text).toBe('Plain rice. Japanese')
  })

  it('produces deterministic text for the same input (idempotent embeds)', () => {
    const recipe = {
      title: 'Risotto',
      cuisine: 'Italian',
      ingredients: [{ name: 'arborio rice' }, { name: 'parmesan' }],
    }
    expect(recipeText(recipe)).toBe(recipeText(recipe))
  })
})
