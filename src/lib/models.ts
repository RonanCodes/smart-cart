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
  /** Weekly menu planning: needs careful constraint reasoning (diet, budget, allergies). */
  primary: anthropic('claude-opus-4-8'),
  /** Cheap/fast: classification, swaps, recipe tagging. */
  fast: anthropic('claude-haiku-4-5-20251001'),
  alternate: openai('gpt-5'),
  cheap: google('gemini-2.5-flash'),
} as const
