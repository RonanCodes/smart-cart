/**
 * Resolve the hero image for AH/Jumbo catalogue recipes to our die-cut sticker
 * PNGs in public/stickers/recipes/{recipeId}.png. Falls back to the scraped URL
 * for other sources or when no sticker path applies.
 */
export function recipeImageUrl(
  recipeId: string,
  rawImageUrl: string | null | undefined,
): string | null {
  if (!rawImageUrl) return null
  if (recipeId.startsWith('ah-') || recipeId.startsWith('jumbo-')) {
    return `/stickers/recipes/${recipeId}.png`
  }
  return rawImageUrl
}
