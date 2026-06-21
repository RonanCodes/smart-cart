import { describe, it, expect, vi, afterEach } from 'vitest'
import { calaSearch, mapSearchResult } from './cala'

describe('mapSearchResult', () => {
  it('flattens context[].origins[].source into {name,url} citations', () => {
    const result = mapSearchResult({
      content: 'Asparagus is in season in the Netherlands from April to June.',
      context: [
        {
          origins: [
            {
              source: {
                name: 'Wikipedia',
                url: 'https://en.wikipedia.org/wiki/Asparagus',
              },
            },
          ],
        },
        {
          origins: [
            {
              source: {
                name: 'NL Gov',
                url: 'https://www.netherlands.nl/asparagus',
              },
            },
          ],
        },
      ],
    })

    expect(result.content).toBe(
      'Asparagus is in season in the Netherlands from April to June.',
    )
    expect(result.sources).toEqual([
      { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Asparagus' },
      { name: 'NL Gov', url: 'https://www.netherlands.nl/asparagus' },
    ])
  })

  it('dedups by url (keeping the first name) and falls back to url for a missing name', () => {
    const result = mapSearchResult({
      content: 'x',
      context: [
        {
          origins: [
            { source: { name: 'First', url: 'https://a.example' } },
            { source: { name: 'Dup', url: 'https://a.example' } },
            { source: { url: 'https://b.example' } },
          ],
        },
      ],
    })

    expect(result.sources).toEqual([
      { name: 'First', url: 'https://a.example' },
      { name: 'https://b.example', url: 'https://b.example' },
    ])
  })

  it('tolerates missing content / context (-> empty)', () => {
    expect(mapSearchResult({})).toEqual({ content: '', sources: [] })
    expect(mapSearchResult({ context: [{ origins: [{}] }] })).toEqual({
      content: '',
      sources: [],
    })
  })
})

describe('calaSearch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('POSTs with the X-API-KEY header and maps the response to {content,sources}', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: 'Stamppot is a traditional Dutch dish.',
            context: [
              {
                origins: [
                  { source: { name: 'Source A', url: 'https://a.example' } },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await calaSearch('tell me about stamppot', 'clsk_test')

    expect(result).toEqual({
      content: 'Stamppot is a traditional Dutch dish.',
      sources: [{ name: 'Source A', url: 'https://a.example' }],
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.cala.ai/v1/knowledge/search')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe(
      'clsk_test',
    )
    // The key must NOT be sent as a bearer token.
    expect(
      (init.headers as Record<string, string>)['Authorization'],
    ).toBeUndefined()
    expect(JSON.parse(init.body as string)).toMatchObject({
      input: 'tell me about stamppot',
      explainability: true,
      return_entities: true,
    })
  })

  it('throws a clear error on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 429 })),
    )

    await expect(calaSearch('q', 'clsk_test')).rejects.toThrow(
      /Cala search failed: 429/,
    )
  })
})
