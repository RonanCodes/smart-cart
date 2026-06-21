import type { CalaSource } from './cala'

/** What the "Souso knows" card needs to fetch its facts. */
export interface RecipeFactsInput {
  /** The catalogue recipe id, used as the cache key. */
  recipeId: string
  /** The dish title, woven into the Cala question. */
  title: string
  /** The cuisine label, when known, to sharpen the question. */
  cuisine?: string | null
}

/**
 * The card payload. `content` is null when Cala is unconfigured or returned
 * nothing, which is the signal the card uses to hide itself completely (no
 * crash, no empty box).
 */
export interface RecipeFactsResult {
  content: string | null
  sources: Array<CalaSource>
}

/**
 * Build the natural-language question we ask Cala for a dish. Pure, so the
 * prompt shape is unit-testable. Asks for one or two verifiable facts about the
 * dish or its main ingredients, with a nudge toward Netherlands seasonality
 * (Souso is Dutch-first), and asks to stay concise (one card, mobile).
 */
export function buildFactsQuestion(
  title: string,
  cuisine?: string | null,
): string {
  const dish = cuisine ? `${title} (${cuisine})` : title
  return (
    `Give one or two interesting, verifiable facts about the dish '${dish}' ` +
    `or its main ingredients. Note any Netherlands seasonality if relevant. ` +
    `Be concise: two short sentences at most.`
  )
}

/**
 * The "Souso knows" facts for a recipe, source-cited via Cala (cala.ai). A plain
 * function (no Start context) so it is unit-testable directly; the createServerFn
 * in recipe-facts-server.ts is a thin wrapper that dynamically imports this.
 *
 * This module is SERVER-ONLY (it dynamic-imports db/client, which statically
 * pulls `cloudflare:workers`). It must never be imported, even for types, by a
 * client component, or that binding leaks into the browser bundle and the build
 * fails resolving `cloudflare:workers`. Components import only the thin server fn.
 *
 * Cache-first: a hit in `recipe_facts` is served without spending a Cala credit
 * (facts about a dish don't change, so the cache never expires here). On a miss
 * we ask Cala one concise question, store the answer + its citations, and return
 * them. Gated on `CALA_API_KEY`: when the key is unset (or Cala errors / returns
 * nothing), we return `{ content: null, sources: [] }` so the card hides cleanly.
 */
export async function fetchRecipeFacts(
  data: RecipeFactsInput,
): Promise<RecipeFactsResult> {
  if (!data.recipeId || !data.title) {
    return { content: null, sources: [] }
  }

  const { getDb } = await import('../db/client')
  const { recipeFacts } = await import('../db/recipe-facts-schema')
  const { eq } = await import('drizzle-orm')
  const db = await getDb()

  // Cache-first: serve a stored answer without touching Cala (credit budget).
  const cached = (
    await db
      .select({
        content: recipeFacts.content,
        sourcesJson: recipeFacts.sourcesJson,
      })
      .from(recipeFacts)
      .where(eq(recipeFacts.recipeId, data.recipeId))
      .limit(1)
  )[0]
  if (cached) {
    return {
      content: cached.content,
      sources: parseSources(cached.sourcesJson),
    }
  }

  // Cache miss. Need a key to ask Cala; without one, hide the card.
  const { readEnv } = await import('./env')
  const apiKey = (await readEnv('CALA_API_KEY'))?.trim()
  if (!apiKey) return { content: null, sources: [] }

  let result: { content: string; sources: Array<CalaSource> }
  try {
    const { calaSearch } = await import('./cala')
    result = await calaSearch(
      buildFactsQuestion(data.title, data.cuisine),
      apiKey,
    )
  } catch {
    // Cala unreachable / non-2xx: degrade to hidden, never crash the sheet.
    return { content: null, sources: [] }
  }

  if (!result.content) return { content: null, sources: [] }

  // Store for next time so we only ever spend one credit per recipe. Ignore a
  // write race (another request cached it first): the read above is the gate.
  try {
    await db
      .insert(recipeFacts)
      .values({
        recipeId: data.recipeId,
        content: result.content,
        sourcesJson: JSON.stringify(result.sources),
      })
      .onConflictDoNothing()
  } catch {
    // Caching is best-effort; a failed write just means we re-ask next time.
  }

  return { content: result.content, sources: result.sources }
}

/** Parse the stored sources JSON, tolerating anything malformed (-> empty). */
function parseSources(json: string): Array<CalaSource> {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is CalaSource =>
        !!s && typeof s.name === 'string' && typeof s.url === 'string',
    )
  } catch {
    return []
  }
}
