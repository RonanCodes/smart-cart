import { createServerFn } from '@tanstack/react-start'
import type { CalaSource } from './cala'

/**
 * Admin recipe-inspector server fns. Each generates an external artefact ONCE
 * and caches it in `recipe_media`, so a second load reads the cache and never
 * re-calls the API. Admin-gated, server-only: every server import is lazy so
 * none of it (db, env, Pixverse/Cala keys, the AI SDK) reaches the client bundle
 * (the admin-server / match-server / recipe-facts-server pattern).
 */

/** The "Souso knows" payload, with where it came from so the UI can label it. */
export interface SousoKnows {
  content: string
  sources: Array<CalaSource>
  /** 'cala' when the real CALA API answered; 'llm' on the grounded fallback. */
  source: 'cala' | 'llm'
}

/** The cached media for one recipe (nulls until a button generates them). */
export interface RecipeMediaView {
  recipeId: string
  videoUrl: string | null
  videoStatus: string | null
  videoAt: string | null
  souso: SousoKnows | null
  sousoAt: string | null
}

/** Result of a generate-video attempt. `error` is set when nothing was cached. */
export interface GenerateVideoResult {
  videoUrl: string | null
  /** A user-facing message when generation could not produce a URL. */
  error: string | null
  /** True when the failure was Pixverse running out of credits (top-up + retry). */
  outOfCredits?: boolean
}

function iso(d: Date | number | null): string | null {
  if (d === null) return null
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString()
}

function parseSouso(json: string | null): SousoKnows | null {
  if (!json) return null
  try {
    const p = JSON.parse(json) as Partial<SousoKnows>
    if (typeof p.content !== 'string') return null
    return {
      content: p.content,
      sources: Array.isArray(p.sources) ? p.sources : [],
      source: p.source === 'cala' ? 'cala' : 'llm',
    }
  } catch {
    return null
  }
}

/** Read the cached media row for one recipe, or a null-filled view if none. */
export const getRecipeMedia = createServerFn({ method: 'GET' })
  .inputValidator((d: { recipeId: string }) => d)
  .handler(async ({ data }): Promise<RecipeMediaView> => {
    const { isAdmin } = await import('./admin-server')
    if (!(await isAdmin())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { recipeMedia } = await import('../db/recipe-media-schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()
    const row = (
      await db
        .select()
        .from(recipeMedia)
        .where(eq(recipeMedia.recipeId, data.recipeId))
        .limit(1)
    )[0]
    if (!row) {
      return {
        recipeId: data.recipeId,
        videoUrl: null,
        videoStatus: null,
        videoAt: null,
        souso: null,
        sousoAt: null,
      }
    }
    return {
      recipeId: row.recipeId,
      videoUrl: row.videoUrl,
      videoStatus: row.videoStatus,
      videoAt: iso(row.videoAt),
      souso: parseSouso(row.sousoKnows),
      sousoAt: iso(row.sousoKnowsAt),
    }
  })

/**
 * Generate (or return the cached) cooking video for a recipe. Cache-first: if a
 * videoUrl is already stored we return it with no Pixverse call. Otherwise we
 * build a prompt from the recipe's title + steps, run the Pixverse text-to-video
 * job to completion, and cache the URL. A failure (e.g. out of credits) is NOT
 * cached, so a top-up and retry just works.
 */
export const generateRecipeVideo = createServerFn({ method: 'POST' })
  .inputValidator((d: { recipeId: string }) => d)
  .handler(async ({ data }): Promise<GenerateVideoResult> => {
    const { isAdmin } = await import('./admin-server')
    if (!(await isAdmin())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { recipeMedia } = await import('../db/recipe-media-schema')
    const { recipe } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    // Cache-first: an existing URL means we never spend a Pixverse credit again.
    const cached = (
      await db
        .select({ videoUrl: recipeMedia.videoUrl })
        .from(recipeMedia)
        .where(eq(recipeMedia.recipeId, data.recipeId))
        .limit(1)
    )[0]
    if (cached?.videoUrl) return { videoUrl: cached.videoUrl, error: null }

    const rec = (
      await db
        .select({
          title: recipe.title,
          instructions: recipe.instructions,
        })
        .from(recipe)
        .where(eq(recipe.id, data.recipeId))
        .limit(1)
    )[0]
    if (!rec) return { videoUrl: null, error: 'Recipe not found' }

    const { readEnv } = await import('./env')
    const apiKey = (await readEnv('PIXVERSE_API_KEY'))?.trim()
    if (!apiKey) {
      return { videoUrl: null, error: 'No PIXVERSE_API_KEY set' }
    }

    const {
      generateVideo,
      buildCookingPrompt,
      PixverseError,
      PIXVERSE_INSUFFICIENT_BALANCE,
    } = await import('./pixverse')
    const prompt = buildCookingPrompt(rec.title, rec.instructions)

    try {
      const url = await generateVideo(prompt, apiKey)
      await db
        .insert(recipeMedia)
        .values({
          recipeId: data.recipeId,
          videoUrl: url,
          videoStatus: 'done',
          videoPrompt: prompt,
          videoAt: new Date(),
        })
        .onConflictDoUpdate({
          target: recipeMedia.recipeId,
          set: {
            videoUrl: url,
            videoStatus: 'done',
            videoPrompt: prompt,
            videoAt: new Date(),
          },
        })
      return { videoUrl: url, error: null }
    } catch (err) {
      if (
        err instanceof PixverseError &&
        err.code === PIXVERSE_INSUFFICIENT_BALANCE
      ) {
        // Do NOT cache: a top-up + retry should succeed without a stale failure.
        return {
          videoUrl: null,
          error: 'Pixverse out of credits',
          outOfCredits: true,
        }
      }
      return {
        videoUrl: null,
        error: err instanceof Error ? err.message : 'Pixverse failed',
      }
    }
  })

/**
 * Generate (or return the cached) "Souso knows" health/food blurb for a recipe.
 * Cache-first: a stored blurb is returned with no external call.
 *
 * SOURCE = CALA (cala.ai), the intended provider for verified, source-cited
 * facts. We reuse the existing CALA client (src/lib/cala.ts) and question
 * builder. When CALA_API_KEY is absent OR the call errors, we fall back to an
 * LLM-generated blurb grounded in the recipe's own ingredients + steps, so the
 * button ALWAYS produces something cacheable (the card never just hides). The
 * stored payload records which source answered so the UI can label it.
 *
 * TODO: the CALA path runs whenever CALA_API_KEY is set; the live endpoint shape
 * (api.cala.ai/v1/knowledge/search) is the one already wired for the consumer
 * "Souso knows" card. Confirm against current CALA docs when the key lands.
 */
export const generateSousoKnows = createServerFn({ method: 'POST' })
  .inputValidator((d: { recipeId: string }) => d)
  .handler(async ({ data }): Promise<SousoKnows> => {
    const { isAdmin } = await import('./admin-server')
    if (!(await isAdmin())) throw new Error('forbidden')
    const { getDb } = await import('../db/client')
    const { recipeMedia } = await import('../db/recipe-media-schema')
    const { recipe } = await import('../db/schema')
    const { eq } = await import('drizzle-orm')
    const db = await getDb()

    const cached = (
      await db
        .select({ sousoKnows: recipeMedia.sousoKnows })
        .from(recipeMedia)
        .where(eq(recipeMedia.recipeId, data.recipeId))
        .limit(1)
    )[0]
    const cachedSouso = parseSouso(cached?.sousoKnows ?? null)
    if (cachedSouso) return cachedSouso

    const rec = (
      await db
        .select({
          title: recipe.title,
          cuisine: recipe.cuisine,
          ingredients: recipe.ingredients,
          instructions: recipe.instructions,
        })
        .from(recipe)
        .where(eq(recipe.id, data.recipeId))
        .limit(1)
    )[0]
    if (!rec) throw new Error('Recipe not found')

    const souso = await produceSousoKnows({
      title: rec.title,
      cuisine: rec.cuisine,
      ingredients: rec.ingredients.map((i) => i.name),
      instructions: rec.instructions,
    })

    await db
      .insert(recipeMedia)
      .values({
        recipeId: data.recipeId,
        sousoKnows: JSON.stringify(souso),
        sousoKnowsAt: new Date(),
      })
      .onConflictDoUpdate({
        target: recipeMedia.recipeId,
        set: { sousoKnows: JSON.stringify(souso), sousoKnowsAt: new Date() },
      })
    return souso
  })

/**
 * Produce the Souso knows blurb: try CALA first (the intended source), fall back
 * to an LLM grounded on the recipe. Server-only; lazily imports its deps.
 */
async function produceSousoKnows(input: {
  title: string
  cuisine: string | null
  ingredients: Array<string>
  instructions: Array<string>
}): Promise<SousoKnows> {
  const { readEnv } = await import('./env')
  const apiKey = (await readEnv('CALA_API_KEY'))?.trim()

  // CALA is the intended source. Use it when the key is present.
  if (apiKey) {
    try {
      const { calaSearch } = await import('./cala')
      const { buildFactsQuestion } = await import('./recipe-facts-core')
      const result = await calaSearch(
        buildFactsQuestion(input.title, input.cuisine),
        apiKey,
      )
      if (result.content) {
        return {
          content: result.content,
          sources: result.sources,
          source: 'cala',
        }
      }
    } catch {
      // CALA unreachable / non-2xx: fall through to the LLM so the button still
      // produces something cacheable.
    }
  }

  // LLM fallback: grounded on this recipe's own ingredients + steps so the blurb
  // is about THIS dish, not generic. CALA is the intended source (above); this
  // keeps the feature demoable when the key/endpoint are not yet wired.
  const { models } = await import('./models')
  const { generateText } = await import('./braintrust-ai')
  const dish = input.cuisine ? `${input.title} (${input.cuisine})` : input.title
  const ingredients = input.ingredients.slice(0, 12).join(', ')
  const steps = input.instructions.slice(0, 6).join(' ')
  const prompt =
    `You are Souso, a warm, plain-spoken Dutch-first food companion. ` +
    `Write a short health and food note about the dish "${dish}". ` +
    `Ingredients: ${ingredients || 'unknown'}. ` +
    `Steps: ${steps || 'unknown'}. ` +
    `Give a one-sentence nutrition summary, then one or two genuine food facts ` +
    `about the dish or its main ingredients. Keep it to three short sentences. ` +
    `Plain sentences, no dashes, no marketing words.`

  try {
    const { text } = await generateText({ model: models.fast, prompt })
    const content = text.trim()
    if (content) return { content, sources: [], source: 'llm' }
  } catch {
    // Even the LLM failed: still return something cacheable + honest.
  }
  return {
    content:
      'Souso could not gather food facts for this dish right now. Try again later.',
    sources: [],
    source: 'llm',
  }
}
