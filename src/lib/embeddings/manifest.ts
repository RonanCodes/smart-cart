/**
 * The embedding index manifest: the model + dimensions every vector in D1 was
 * built with. The committed index (data/embeddings/manifest.json) carries these,
 * and the runtime asserts they match before trusting a query, so a stale index
 * (re-embedded with a different model/dims) fails loud instead of silently
 * returning garbage cosine scores. ADR-0004.
 *
 * Pure: no I/O, importable from anywhere (script, Worker, test).
 */

/** The embedding model. OpenAI, multilingual (NL/EN), no synonym table needed. */
export const EMBEDDING_MODEL = 'text-embedding-3-small'

/** Reduced dimension. 3-small supports dimension reduction with little quality
 * loss; 256 keeps each vector at 1 KB (Float32) so it fits in D1 / memory. */
export const EMBEDDING_DIMENSIONS = 256

/** How vectors are encoded in D1 and the committed files. */
export const EMBEDDING_ENCODING = 'base64-float32' as const

export interface EmbeddingManifest {
  model: string
  dimensions: number
  encoding: string
  /** ISO timestamp the index was built (set by scripts/embed-catalogue.ts). */
  generatedAt: string
}

/**
 * Throw if a committed/loaded index was not built with the model + dims the
 * runtime expects. The fix is always "re-run pnpm embed:catalogue".
 */
export function assertManifest(m: EmbeddingManifest): void {
  if (m.model !== EMBEDDING_MODEL || m.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding index mismatch: built with ${m.model}/${m.dimensions}d, ` +
        `runtime expects ${EMBEDDING_MODEL}/${EMBEDDING_DIMENSIONS}d. ` +
        `Re-run pnpm embed:catalogue.`,
    )
  }
}
