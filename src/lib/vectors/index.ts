/**
 * Production "similar recipes" via Cloudflare Vectorize + Workers AI embeddings
 * (bge-m3, 1024-dim, multilingual so it handles Dutch recipe text). The swipe
 * onboarding itself uses the in-Worker recsys (fast, no per-swipe API call); this
 * module is for cross-catalogue similarity and substitutions at scale.
 */

export { recipeText } from './recipe-text'
export type { RecipeForEmbedding } from './recipe-text'

interface Env {
  AI: Ai
  RECIPES_VECTORS: VectorizeIndex
}

async function env(): Promise<Env> {
  const { env: e } = await import('cloudflare:workers')
  return e as unknown as Env
}

/** Embed one piece of text to a 1024-dim vector via Workers AI bge-m3. */
export async function embed(text: string): Promise<Array<number>> {
  const e = await env()
  const res = (await e.AI.run('@cf/baai/bge-m3', { text: [text] })) as {
    data: Array<Array<number>>
  }
  return res.data[0] ?? []
}

export interface VectorRecipe {
  id: string
  text: string
  metadata: Record<string, VectorizeVectorMetadataValue>
}

/** Embed + upsert a batch of recipes into Vectorize. */
export async function upsertRecipes(
  items: Array<VectorRecipe>,
): Promise<number> {
  const e = await env()
  const vectors: Array<VectorizeVector> = []
  for (const it of items) {
    vectors.push({
      id: it.id,
      values: await embed(it.text),
      metadata: it.metadata,
    })
  }
  await e.RECIPES_VECTORS.upsert(vectors)
  return vectors.length
}

/** Nearest recipes to a query vector (returns ids + scores + metadata). */
export async function similar(
  vector: Array<number>,
  topK = 10,
): Promise<Array<{ id: string; score: number }>> {
  const e = await env()
  const res = await e.RECIPES_VECTORS.query(vector, { topK })
  return res.matches.map((m) => ({ id: m.id, score: m.score }))
}

/** Convenience: recipes similar to a free-text query. */
export async function similarToText(
  text: string,
  topK = 10,
): Promise<Array<{ id: string; score: number }>> {
  return similar(await embed(text), topK)
}
