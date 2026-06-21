/**
 * Cala (cala.ai) verified-web-knowledge client. Cala returns SOURCE-CITED facts
 * pulled from the public web, so an answer can be grounded in real provenance
 * instead of hallucinated (fits Souso's "AI grounded, never hallucinate" rule).
 *
 * Workers-safe: plain global `fetch`, no SDK, one custom header (`X-API-KEY`,
 * NOT `Authorization: Bearer`). The `clsk_` key is a server-only secret, so this
 * module is only ever pulled in via a dynamic import inside a server fn handler.
 *
 * Credits: 1 search = 1 credit, so callers MUST cache (see recipe-facts-server).
 */

const BASE = 'https://api.cala.ai/v1'

/** A citation: the human-readable source name and the URL we link to. */
export interface CalaSource {
  name: string
  url: string
}

/**
 * The raw `/knowledge/search` response shape, narrowed to the fields we use. The
 * citations live at `context[].origins[].source.{name,url}` (provenance for each
 * snippet that backs the answer).
 */
interface CalaSearchResponse {
  content?: string
  context?: Array<{
    origins?: Array<{
      source?: { name?: string; url?: string }
    }>
  }>
}

/** A search result mapped to exactly what the card needs: prose + dedup'd sources. */
export interface CalaSearchResult {
  /** The markdown answer Cala returned (treat as untrusted web content). */
  content: string
  /** Distinct citations, in first-seen order, each with a name + url. */
  sources: Array<CalaSource>
}

/**
 * Run one natural-language knowledge search and map the response to
 * `{ content, sources }`. Throws a clear error on any non-2xx so the caller can
 * decide to swallow it (the card degrades to hidden).
 */
export async function calaSearch(
  input: string,
  apiKey: string,
): Promise<CalaSearchResult> {
  const res = await fetch(`${BASE}/knowledge/search`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input,
      explainability: true,
      return_entities: true,
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Cala search failed: ${res.status} ${detail}`.trim())
  }

  const data: CalaSearchResponse = await res.json()
  return mapSearchResult(data)
}

/**
 * Pure mapper: raw Cala response -> `{ content, sources }`. Flattens every
 * `context[].origins[].source` into a citation list, dedup'd by URL and keeping
 * the first name seen for each. Split out so it is unit-testable without a fetch.
 */
export function mapSearchResult(data: CalaSearchResponse): CalaSearchResult {
  const seen = new Set<string>()
  const sources: Array<CalaSource> = []

  for (const ctx of data.context ?? []) {
    for (const origin of ctx.origins ?? []) {
      const url = origin.source?.url?.trim()
      if (!url || seen.has(url)) continue
      seen.add(url)
      sources.push({ name: origin.source?.name?.trim() || url, url })
    }
  }

  return { content: (data.content ?? '').trim(), sources }
}
