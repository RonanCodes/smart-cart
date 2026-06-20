import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { google } from '@ai-sdk/google'

/**
 * Provider abstraction for the meal-planning agent. Swap a model = change one line.
 * Keys are Worker secrets (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY).
 *
 * For AI feature patterns (streamText, generateObject, tool loops, prompt caching),
 * load /ro:vercel-ai-sdk before adding or modifying any AI feature.
 */
export const models = {
  // OpenAI is the active provider (Ronan + Nicolas both use it). Anthropic is kept
  // wired as a one-line switch. Needs the OPENAI_API_KEY Worker secret.
  /** Weekly menu planning + agent: careful constraint reasoning. */
  primary: openai('gpt-5'),
  /** Cheap/fast: classification, swaps, replan parsing. */
  fast: openai('gpt-5'),
  /** Kept available for a quick provider switch. */
  alternate: anthropic('claude-opus-4-8'),
  cheap: google('gemini-2.5-flash'),
  /**
   * Semantic matching embeddings (ADR-0004): ingredient->SKU, dish similarity,
   * replan term-match. Multilingual (NL/EN). Dimension reduction (256) is passed
   * at call time via providerOptions (see src/lib/embeddings/embed.ts), since
   * `openai.embedding(id)` takes no settings object.
   */
  embedding: openai.embedding('text-embedding-3-small'),
} as const
