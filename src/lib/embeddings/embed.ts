/**
 * Server-only query embedding. Wraps the AI SDK `embed` / `embedMany` against the
 * OpenAI model in models.ts, with the dimension reduction (256) passed via
 * providerOptions because `openai.embedding(id)` takes no settings object.
 *
 * Only USER text is embedded at runtime (an ingredient line, a replan term):
 * catalogue vectors are precomputed offline (scripts/embed-catalogue.ts) and
 * loaded from D1. The OpenAI key is read from the env by the provider; with no
 * key the SDK throws and callers degrade honestly (ADR-0004's keyless contract).
 */

import { embed, embedMany } from '../braintrust-ai'
import { models } from '../models'
import { EMBEDDING_DIMENSIONS } from './manifest'

/** Dimension reduction for text-embedding-3-small (OpenAI providerOptions). */
const providerOptions = { openai: { dimensions: EMBEDDING_DIMENSIONS } }

/** True when an OpenAI key is wired, so callers can skip the live embed cleanly. */
export function embeddingKeyPresent(): boolean {
  const env = typeof process !== 'undefined' ? process.env : undefined
  return Boolean(env?.OPENAI_API_KEY)
}

/** Embed one query string to a 256-dim vector. Throws if no key (caller degrades). */
export async function embedQuery(text: string): Promise<Array<number>> {
  const { embedding } = await embed({
    model: models.embedding,
    value: text,
    providerOptions,
  })
  return embedding
}

/** Embed many query strings in one batched call (one request, the whole list). */
export async function embedQueries(
  texts: ReadonlyArray<string>,
): Promise<Array<Array<number>>> {
  if (texts.length === 0) return []
  const { embeddings } = await embedMany({
    model: models.embedding,
    values: texts as Array<string>,
    providerOptions,
  })
  return embeddings
}
