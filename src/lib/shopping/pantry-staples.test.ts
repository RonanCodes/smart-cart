import { describe, expect, it } from 'vitest'
import { isPantryStaple } from './pantry-staples'

describe('isPantryStaple', () => {
  it('matches salt and peppers', () => {
    expect(isPantryStaple('salt')).toBe(true)
    expect(isPantryStaple('Sea Salt')).toBe(true)
    expect(isPantryStaple('  TABLE salt ')).toBe(true)
    expect(isPantryStaple('garlic salt')).toBe(true)
    expect(isPantryStaple('pepper')).toBe(true)
    expect(isPantryStaple('black pepper')).toBe(true)
    expect(isPantryStaple('white pepper')).toBe(true)
    expect(isPantryStaple('ground black pepper')).toBe(true)
  })

  it('matches ground spices', () => {
    expect(isPantryStaple('cumin')).toBe(true)
    expect(isPantryStaple('ground cumin')).toBe(true)
    expect(isPantryStaple('paprika')).toBe(true)
    expect(isPantryStaple('smoked paprika')).toBe(true)
    expect(isPantryStaple('cinnamon')).toBe(true)
    expect(isPantryStaple('oregano')).toBe(true)
    expect(isPantryStaple('dried basil')).toBe(true)
    expect(isPantryStaple('chilli flakes')).toBe(true)
    expect(isPantryStaple('chili flakes')).toBe(true)
    expect(isPantryStaple('turmeric')).toBe(true)
    expect(isPantryStaple('curry powder')).toBe(true)
    expect(isPantryStaple('nutmeg')).toBe(true)
    expect(isPantryStaple('ground coriander')).toBe(true)
  })

  it('matches oils', () => {
    expect(isPantryStaple('olive oil')).toBe(true)
    expect(isPantryStaple('extra virgin olive oil')).toBe(true)
    expect(isPantryStaple('mild olive oil')).toBe(true)
    expect(isPantryStaple('sunflower oil')).toBe(true)
    expect(isPantryStaple('vegetable oil')).toBe(true)
    expect(isPantryStaple('coconut oil')).toBe(true)
    // Matches a trailing phrase even with trailing prose.
    expect(isPantryStaple('extra virgin olive oil for frying')).toBe(true)
  })

  it('matches vinegars', () => {
    expect(isPantryStaple('white wine vinegar')).toBe(true)
    expect(isPantryStaple('balsamic vinegar')).toBe(true)
    expect(isPantryStaple('rice vinegar')).toBe(true)
    expect(isPantryStaple('apple cider vinegar')).toBe(true)
  })

  it('matches flour', () => {
    expect(isPantryStaple('flour')).toBe(true)
    expect(isPantryStaple('plain flour')).toBe(true)
    expect(isPantryStaple('all-purpose flour')).toBe(true)
    expect(isPantryStaple('almond flour')).toBe(true)
    expect(isPantryStaple('self-raising flour')).toBe(true)
    expect(isPantryStaple('self raising flour')).toBe(true)
  })

  it('matches sugar', () => {
    expect(isPantryStaple('sugar')).toBe(true)
    expect(isPantryStaple('white sugar')).toBe(true)
    expect(isPantryStaple('brown sugar')).toBe(true)
    expect(isPantryStaple('caster sugar')).toBe(true)
    expect(isPantryStaple('icing sugar')).toBe(true)
    expect(isPantryStaple('coconut blossom sugar')).toBe(true)
  })

  it('matches the remaining cupboard staples', () => {
    expect(isPantryStaple('vanilla extract')).toBe(true)
    expect(isPantryStaple('vanilla')).toBe(true)
    expect(isPantryStaple('baking soda')).toBe(true)
    expect(isPantryStaple('baking powder')).toBe(true)
    expect(isPantryStaple('bicarbonate of soda')).toBe(true)
    expect(isPantryStaple('honey')).toBe(true)
    expect(isPantryStaple('maple syrup')).toBe(true)
    expect(isPantryStaple('soy sauce')).toBe(true)
    expect(isPantryStaple('ketjap manis')).toBe(true)
    expect(isPantryStaple('stock cube')).toBe(true)
    expect(isPantryStaple('vegetable stock cube')).toBe(true)
    expect(isPantryStaple('bouillon')).toBe(true)
    expect(isPantryStaple('cornflour')).toBe(true)
    expect(isPantryStaple('cornstarch')).toBe(true)
    expect(isPantryStaple('mustard')).toBe(true)
    expect(isPantryStaple('dijon mustard')).toBe(true)
  })

  it('does NOT match fresh produce, meat, fish, or dairy', () => {
    expect(isPantryStaple('chicken thigh')).toBe(false)
    expect(isPantryStaple('chicken breast')).toBe(false)
    expect(isPantryStaple('spinach')).toBe(false)
    expect(isPantryStaple('feta')).toBe(false)
    expect(isPantryStaple('onion')).toBe(false)
    expect(isPantryStaple('red pepper')).toBe(false)
    expect(isPantryStaple('bell pepper')).toBe(false)
    expect(isPantryStaple('tomato')).toBe(false)
    expect(isPantryStaple('salmon fillet')).toBe(false)
    expect(isPantryStaple('minced beef')).toBe(false)
    expect(isPantryStaple('pork belly')).toBe(false)
  })

  it('does NOT match fresh names that merely share a staple word', () => {
    // Dairy / meat / produce that contain a staple keyword are still fresh.
    expect(isPantryStaple('salted butter')).toBe(false)
    expect(isPantryStaple('unsalted butter')).toBe(false)
    expect(isPantryStaple('sugar snap peas')).toBe(false)
    expect(isPantryStaple('honey-glazed ham')).toBe(false)
    expect(isPantryStaple('honey roast ham')).toBe(false)
    expect(isPantryStaple('soy milk')).toBe(false)
    expect(isPantryStaple('mustard greens')).toBe(false)
    expect(isPantryStaple('whole milk')).toBe(false)
    expect(isPantryStaple('cream cheese')).toBe(false)
    expect(isPantryStaple('eggs')).toBe(false)
  })

  it('handles empty and whitespace-only input', () => {
    expect(isPantryStaple('')).toBe(false)
    expect(isPantryStaple('   ')).toBe(false)
  })
})
