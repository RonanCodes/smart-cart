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

import { embedMany } from '../braintrust-ai'
import { models } from '../models'
import { EMBEDDING_DIMENSIONS } from './manifest'

/** Dimension reduction for text-embedding-3-small (OpenAI providerOptions). */
const providerOptions = { openai: { dimensions: EMBEDDING_DIMENSIONS } }

const QUERY_CACHE_CAP = 2000
const queryCache = new Map<string, Promise<Array<number>>>()

function queryKey(text: string): string {
  return text.trim().toLowerCase()
}

function rememberQuery(
  key: string,
  promise: Promise<Array<number>>,
): Promise<Array<number>> {
  if (queryCache.has(key)) queryCache.delete(key)
  queryCache.set(key, promise)
  while (queryCache.size > QUERY_CACHE_CAP) {
    const oldest = queryCache.keys().next().value
    if (oldest === undefined) break
    queryCache.delete(oldest)
  }
  return promise
}

/** True when an OpenAI key is wired, so callers can skip the live embed cleanly. */
export function embeddingKeyPresent(): boolean {
  const env = typeof process !== 'undefined' ? process.env : undefined
  return Boolean(env?.OPENAI_API_KEY)
}

/** Embed one query string to a 256-dim vector. Throws if no key (caller degrades). */
export async function embedQuery(text: string): Promise<Array<number>> {
  const [embedding] = await embedQueries([text])
  if (!embedding) throw new Error('embedding missing')
  return embedding
}

/** Embed many query strings in one batched call (one request, the whole list). */
export async function embedQueries(
  texts: ReadonlyArray<string>,
): Promise<Array<Array<number>>> {
  if (texts.length === 0) return []

  const promises: Array<Promise<Array<number>>> = []
  const misses: Array<{
    key: string
    text: string
    resolve: (value: Array<number>) => void
    reject: (reason?: unknown) => void
  }> = []

  for (const text of texts) {
    const key = queryKey(text)
    const cached = queryCache.get(key)
    if (cached) {
      promises.push(cached)
      continue
    }

    let resolve!: (value: Array<number>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<Array<number>>((res, rej) => {
      resolve = res
      reject = rej
    })
    promises.push(rememberQuery(key, promise))
    misses.push({ key, text, resolve, reject })
  }

  if (misses.length > 0) {
    void embedMany({
      model: models.embedding,
      values: misses.map((m) => m.text),
      providerOptions,
    })
      .then(({ embeddings }) => {
        misses.forEach((miss, i) => {
          const embedding = embeddings[i]
          if (!embedding) {
            queryCache.delete(miss.key)
            miss.reject(new Error(`embedding missing for "${miss.text}"`))
            return
          }
          miss.resolve(embedding)
        })
      })
      .catch((err) => {
        for (const miss of misses) {
          queryCache.delete(miss.key)
          miss.reject(err)
        }
      })
  }

  return Promise.all(promises)
}

/** Visible for tests and local reseed/dev flows. */
export function resetQueryEmbeddingCache(): void {
  queryCache.clear()
}
